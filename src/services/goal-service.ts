import crypto from 'crypto';
import {
  Goal,
  GoalQualityMetrics,
  GoalStatus,
  GoalStatusSummary,
  Task,
} from '../domain/types.js';
import { deviationsOf } from '../domain/criteria.js';
import { GoalCapExceededError, GoalNotFoundError, MandatoryReasonMissingError } from '../domain/errors.js';
import { IDecisionRepository, IGoalRepository, ITaskRepository, IWorkspaceRepository } from '../infrastructure/repositories/interfaces.js';
import { clearClaim, returnToQueue } from './task-state.js';

export const ADHOC_GOAL_TITLE = 'Ad-hoc work';
const ADHOC_GOAL_CAP = 25;

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
