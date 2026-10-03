import crypto from 'crypto';
import {
  Goal,
  GoalQualityMetrics,
  GoalStatus,
  GoalStatusSummary,
  Task,
} from '../domain/types.js';
import { deviationsOf } from '../domain/criteria.js';
import { GoalCapExceededError, GoalNotFoundError, InvalidArgumentsError, MandatoryReasonMissingError } from '../domain/errors.js';
import { hasLiveLease } from '../domain/lease.js';
import { IDecisionRepository, IGoalRepository, ITaskRepository, IWorkspaceRepository } from '../infrastructure/repositories/interfaces.js';
import { clearClaim, returnToQueue } from './task-state.js';

export const ADHOC_GOAL_TITLE = 'Ad-hoc work';
const ADHOC_GOAL_CAP = 25;
const OPEN_TASK_STATUSES = ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'];

/**
 * Days a finished goal may sit idle before it is closed automatically (MOO_GOAL_AUTOCLOSE_DAYS,
 * default 3); null when set to `off`. Agents rarely close goals themselves, and unclosed goals
 * pile up in every session's context.
 */
export function goalAutoCloseDays(): number | null {
  const raw = (process.env.MOO_GOAL_AUTOCLOSE_DAYS || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === 'never') return null;
  const days = Number(raw);
  return raw && Number.isFinite(days) && days >= 0 ? days : 3;
}

export class GoalService {
  constructor(
    private goalRepo: IGoalRepository,
    private taskRepo: ITaskRepository,
    private workspaceRepo?: IWorkspaceRepository,
    private decisionRepo?: IDecisionRepository
  ) {}

  /**
   * Standing per-workspace goal for small fixes and one-off requests, so agents can create
   * a task without first inventing a goal.
   */
  getOrCreateAdhocGoal(workspaceId: string, projectPath?: string): Goal {
    const existing = this.goalRepo
      .list(undefined, 'active', workspaceId)
      .find((g) => g.title === ADHOC_GOAL_TITLE && g.workspaceId === workspaceId);
    if (existing) return existing;
    const rootPath = projectPath || this.workspaceRepo?.findById(workspaceId)?.rootPath || '';
    return this.createGoal(
      ADHOC_GOAL_TITLE,
      'Standing goal for small fixes and one-off requests created without an explicit goal.',
      rootPath,
      ADHOC_GOAL_CAP,
      undefined,
      workspaceId
    );
  }

  createGoal(
    title: string,
    verbatimPrompt: string,
    projectPath: string,
    maxOpenTasksCap: number = 10,
    description?: string,
    workspaceId?: string
  ): Goal {
    const now = new Date().toISOString();
    const goal: Goal = {
      id: `goal-${crypto.randomUUID().slice(0, 8)}`,
      workspaceId,
      title: title.trim(),
      verbatimPrompt: verbatimPrompt.trim(),
      description: description ? description.trim() : undefined,
      status: 'active',
      maxOpenTasksCap: maxOpenTasksCap > 0 ? maxOpenTasksCap : 10,
      projectPath,
      createdAt: now,
      updatedAt: now,
    };

    return this.goalRepo.create(goal);
  }

  updateGoal(
    goalId: string,
    updates: {
      title?: string;
      description?: string;
      verbatimPrompt?: string;
      maxOpenTasksCap?: number;
      status?: GoalStatus;
      workspaceId?: string;
      /** Retrospective in the closer's words; completing a goal adds the generated record below it. */
      summary?: string;
    }
  ): Goal {
    const goal = this.getGoal(goalId);
    if (updates.workspaceId !== undefined) goal.workspaceId = updates.workspaceId;
    if (updates.title !== undefined) goal.title = updates.title.trim();
    if (updates.description !== undefined) goal.description = updates.description.trim();
    if (updates.verbatimPrompt !== undefined) goal.verbatimPrompt = updates.verbatimPrompt.trim();
    if (updates.maxOpenTasksCap !== undefined && updates.maxOpenTasksCap > 0) {
      goal.maxOpenTasksCap = updates.maxOpenTasksCap;
    }
    if (updates.status !== undefined) {
      goal.status = updates.status;
      if (updates.status === 'completed') {
        goal.completedAt = new Date().toISOString();
        goal.summary = this.buildSummary(goal, updates.summary);
      }
    }
    goal.updatedAt = new Date().toISOString();
    return this.goalRepo.update(goal);
  }

  getGoal(goalId: string): Goal {
    const goal = this.goalRepo.findById(goalId);
    if (!goal) {
      throw new GoalNotFoundError(goalId);
    }
    return goal;
  }

  listGoals(projectPath?: string, status?: GoalStatus, workspaceId?: string): Goal[] {
    return this.goalRepo.list(projectPath, status, workspaceId);
  }

  getGoalStatus(goalId: string): GoalStatusSummary {
    const goal = this.getGoal(goalId);
    const tasks = this.taskRepo.listByGoalId(goalId).filter((t) => !t.isArchived);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'done').length;
    const droppedTasks = tasks.filter((t) => t.status === 'dropped').length;
    const blockedTasks = tasks.filter((t) => t.status === 'blocked-on-dependency').length;
    const waitingOnHumanTasks = tasks.filter((t) => t.status === 'waiting-on-human').length;
    const openTasks = tasks.filter((t) =>
      ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(t.status)
    ).length;

    const looseEnds = tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped');
    const isFullyCovered = totalTasks > 0 && looseEnds.length === 0;
    const hasReachedCap = openTasks >= goal.maxOpenTasksCap;

    return {
      quality: this.qualityMetrics(tasks),
      goal,
      totalTasks,
      openTasks,
      completedTasks,
      droppedTasks,
      blockedTasks,
      waitingOnHumanTasks,
      isFullyCovered,
      looseEnds,
      hasReachedCap,
    };
  }

  qualityMetrics(tasks: Task[]): GoalQualityMetrics {
    const done = tasks.filter((t) => t.status === 'done');
    const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) / 100 : null);
    const cycles = done
      .map((t) => (new Date(t.completedAt || t.updatedAt).getTime() - new Date(t.claimedAt || t.createdAt).getTime()) / 60_000)
      .filter((m) => Number.isFinite(m) && m >= 0);
    const criteria = done.flatMap((t) => t.evidence?.criteria || []);
    const runs = done.map((t) => t.evidence?.verification).filter(Boolean);
    return {
      avgCycleMinutes: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
      totalAttempts: done.reduce((n, t) => n + (t.attemptCount || 0), 0),
      reopens: tasks.reduce((n, t) => n + (t.reopenCount || 0), 0),
      criteriaMetRate: rate(criteria.filter((c) => c.met).length, criteria.length),
      tasksWithDeviations: done.filter((t) => deviationsOf(t.evidence?.criteria).length > 0 || (t.evidence?.verification && !t.evidence.verification.passed)).length,
      verifyPassRate: rate(runs.filter((r) => r!.passed).length, runs.length),
      committedRate: rate(done.filter((t) => t.commits?.length).length, done.length),
      discoveredWork: tasks.filter((t) => t.discoveredFromTaskId).length,
    };
  }

  /** Markdown record written when a goal is completed: what shipped, what deviated, what was decided. */
  buildSummary(goal: Goal, closingNote?: string): string {
    const tasks = this.taskRepo.listByGoalId(goal.id).filter((t) => !t.isArchived);
    const done = tasks.filter((t) => t.status === 'done');
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped');
    const dropped = tasks.filter((t) => t.status === 'dropped');
    const q = this.qualityMetrics(tasks);
    const pct = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
    const lines: string[] = [];
    if (closingNote?.trim()) lines.push(closingNote.trim(), '');
    lines.push(`**Shipped** (${done.length}/${tasks.length - dropped.length}):`);
    for (const t of done) {
      const commits = t.commits?.length ? ` — ${t.commits.map((c) => c.slice(0, 9)).join(', ')}` : '';
      lines.push(`- ${t.title} (${t.id})${t.discoveredFromTaskId ? ' [discovered]' : ''}${commits}`);
    }
    const deviations = done.flatMap((t) => [
      ...deviationsOf(t.evidence?.criteria).map((d) => `- ${t.title}: ${d.item} — ${d.note || 'no note'}`),
      ...(t.evidence?.verification && !t.evidence.verification.passed
        ? [`- ${t.title}: verify \`${t.evidence.verification.command}\` failed — ${t.evidence.verification.overrideReason || 'no reason'}`]
        : []),
    ]);
    if (deviations.length) lines.push('', `**Deviations** (${deviations.length}):`, ...deviations);
    if (open.length) lines.push('', `**Left open** (${open.length}):`, ...open.map((t) => `- ${t.title} (${t.id}, ${t.status})`));
    if (dropped.length) lines.push('', `**Dropped** (${dropped.length}):`, ...dropped.map((t) => `- ${t.title}${t.droppedReason ? ` — ${t.droppedReason}` : ''}`));
    const decisions = (this.decisionRepo?.list(undefined, undefined, undefined, goal.workspaceId) || []).filter(
      (d) => d.createdAt >= goal.createdAt && d.status !== 'rejected'
    );
    if (decisions.length) lines.push('', `**Decisions** (${decisions.length}):`, ...decisions.map((d) => `- ${d.title}: ${d.choice.slice(0, 160)}`));
    lines.push(
      '',
      `**Metrics**: avg cycle ${q.avgCycleMinutes ?? 'n/a'} min · attempts ${q.totalAttempts} · reopens ${q.reopens} · criteria met ${pct(q.criteriaMetRate)} · verify passed ${pct(q.verifyPassRate)} · committed ${pct(q.committedRate)} · discovered ${q.discoveredWork}`
    );
    return lines.join('\n');
  }

  checkGoalCap(goalId?: string): void {
    if (!goalId) return;
    const goal = this.goalRepo.findById(goalId);
    if (!goal) return;

    const openCount = this.goalRepo.countOpenTasks(goalId);
    if (openCount >= goal.maxOpenTasksCap) {
      throw new GoalCapExceededError(goalId, goal.maxOpenTasksCap);
    }
  }

  killGoal(goalId: string, reason: string, authorId: string): { goal: Goal; droppedTaskCount: number } {
    return this.taskRepo.runExclusive(() => this.killGoalLocked(goalId, reason, authorId));
  }

  private killGoalLocked(goalId: string, reason: string, authorId: string): { goal: Goal; droppedTaskCount: number } {
    if (!reason || !reason.trim()) {
      throw new MandatoryReasonMissingError('killing/dropping a goal');
    }

    const goal = this.getGoal(goalId);
    const now = new Date().toISOString();
    goal.status = 'dropped';
    goal.droppedReason = reason.trim();
    goal.updatedAt = now;
    this.goalRepo.update(goal);

    // Cascade drop all open tasks under this goal
    const openTasks = this.taskRepo
      .listByGoalId(goalId)
      .filter((t) => ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(t.status));

    for (const task of openTasks) {
      task.status = 'dropped';
      task.droppedReason = `Goal dropped: ${reason.trim()}`;
      task.updatedAt = now;
      task.lastStateChangeAt = now;
      clearClaim(task);
      this.taskRepo.update(task);
    }

    return { goal, droppedTaskCount: openTasks.length };
  }

  /**
   * Completes active goals whose tasks are all finished (at least one done) and that saw no
   * activity for idleDays, with a generated summary. idleDays 0 closes every finished goal (the
   * board's bulk action). The Ad-hoc goal is a standing goal and never closes.
   */
  closeFinishedGoals(workspaceId: string, idleDays: number, now: Date = new Date()): Goal[] {
    const closed: Goal[] = [];
    for (const goal of this.goalRepo.list(undefined, 'active', workspaceId)) {
      if (goal.title === ADHOC_GOAL_TITLE) continue;
      const tasks = this.taskRepo.listByGoalId(goal.id);
      if (!tasks.some((t) => t.status === 'done') || tasks.some((t) => OPEN_TASK_STATUSES.includes(t.status))) continue;
      const lastActivity = Math.max(
        new Date(goal.updatedAt).getTime(),
        ...tasks.map((t) => new Date(t.completedAt || t.updatedAt).getTime())
      );
      if (now.getTime() - lastActivity < idleDays * 86_400_000) continue;
      closed.push(
        this.updateGoal(goal.id, {
          status: 'completed',
          summary:
            idleDays > 0
              ? `Closed automatically: every task was finished and the goal saw no activity for ${idleDays}+ days.`
              : 'Closed from the board: every task was finished.',
        })
      );
    }
    return closed;
  }

  /** Session-start housekeeping: closes finished goals idle past goalAutoCloseDays(); never throws. */
  closeIdleGoals(workspaceId: string | undefined): Goal[] {
    const days = goalAutoCloseDays();
    if (days === null || !workspaceId) return [];
    try {
      return this.closeFinishedGoals(workspaceId, days);
    } catch {
      return [];
    }
  }

  /**
   * Moves a goal filed under the wrong project, with all of its tasks, to another workspace in one
   * transaction. The Ad-hoc goal belongs to its workspace and stays. Tasks an agent is working on
   * must be finished or released first, since that agent's session is scoped to the old workspace.
   * Dependency links to tasks outside the goal are kept and reported.
   */
  moveGoal(
    goalId: string,
    targetWorkspaceId: string
  ): { goal: Goal; movedTaskCount: number; crossWorkspaceDependencies: { taskId: string; dependsOnTaskId: string }[] } {
    return this.taskRepo.runExclusive(() => {
      const goal = this.getGoal(goalId);
      const target = this.workspaceRepo?.findById(targetWorkspaceId);
      if (!target) throw new InvalidArgumentsError(`Workspace ${targetWorkspaceId} not found.`);
      if (goal.title === ADHOC_GOAL_TITLE) {
        throw new InvalidArgumentsError('The "Ad-hoc work" goal belongs to its workspace and cannot be moved.');
      }
      if (goal.workspaceId === target.id) return { goal, movedTaskCount: 0, crossWorkspaceDependencies: [] };

      const tasks = this.taskRepo.listByGoalId(goalId);
      const claimed = tasks.filter((t) => t.status === 'doing' && hasLiveLease(t));
      if (claimed.length > 0) {
        throw new InvalidArgumentsError(
          `${claimed.map((t) => t.id).join(', ')} ${claimed.length === 1 ? 'is' : 'are'} being worked on; finish or release ${claimed.length === 1 ? 'it' : 'them'} before moving the goal.`
        );
      }

      const now = new Date().toISOString();
      goal.workspaceId = target.id;
      goal.projectPath = target.rootPath;
      goal.updatedAt = now;
      this.goalRepo.update(goal);
      for (const task of tasks) {
        task.workspaceId = target.id;
        task.updatedAt = now;
        this.taskRepo.update(task);
      }

      const ids = new Set(tasks.map((t) => t.id));
      const crossWorkspaceDependencies: { taskId: string; dependsOnTaskId: string }[] = [];
      for (const task of tasks) {
        for (const dep of this.taskRepo.getDependencies(task.id)) {
          if (!ids.has(dep)) crossWorkspaceDependencies.push({ taskId: task.id, dependsOnTaskId: dep });
        }
        for (const dependent of this.taskRepo.getDependents(task.id)) {
          if (!ids.has(dependent)) crossWorkspaceDependencies.push({ taskId: dependent, dependsOnTaskId: task.id });
        }
      }
      return { goal, movedTaskCount: tasks.length, crossWorkspaceDependencies };
    });
  }

  reopenGoal(goalId: string, authorId: string, reopenTasks: boolean = true): Goal {
    return this.taskRepo.runExclusive(() => this.reopenGoalLocked(goalId, authorId, reopenTasks));
  }

  private reopenGoalLocked(goalId: string, authorId: string, reopenTasks: boolean = true): Goal {
    const goal = this.getGoal(goalId);
    const now = new Date().toISOString();
    goal.status = 'active';
    goal.droppedReason = undefined;
    goal.completedAt = undefined;
    goal.updatedAt = now;
    this.goalRepo.update(goal);

    if (reopenTasks) {
      const droppedTasks = this.taskRepo.listByGoalId(goalId).filter((t) => t.status === 'dropped');
      for (const task of droppedTasks) {
        returnToQueue(this.taskRepo, task);
        task.droppedReason = undefined;
        task.reopenCount += 1;
        task.updatedAt = now;
        task.lastStateChangeAt = now;
        this.taskRepo.update(task);
      }
    }

    return goal;
  }
}
