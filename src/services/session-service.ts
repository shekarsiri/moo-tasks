import fs from 'fs';
import path from 'path';
import { Decision, NoteType, SessionResumeSummary, StaleTask, Task, TaskNote, TaskStatus } from '../domain/types.js';
import { hasLiveLease } from '../domain/lease.js';
import { ADHOC_GOAL_TITLE } from './goal-service.js';
import {
  ITaskRepository,
  IGoalRepository,
  IDecisionRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';

export interface FileContextSummary {
  filePaths: string[];
  activeLocks: Array<{
    taskId: string;
    taskTitle: string;
    claimedByAgent?: string;
    declaredFiles: string[];
    leaseExpiresAt?: string;
  }>;
  pastTasks: Task[];
  relevantDecisions: Decision[];
  recentNotes: Array<{
    taskId: string;
    noteType: string;
    content: string;
    createdAt: string;
    authorId: string;
  }>;
}

export interface StallWarning {
  taskId: string;
  taskTitle: string;
  claimedByAgent?: string;
  warningType: 'thrashing' | 'lease_stalled' | 'excessive_reopens' | 'missing_heartbeat';
  message: string;
  suggestedAction: string;
}

const OPEN_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'];
const STALE_TODO_DAYS = 14;
const STALE_DEFERRED_DAYS = 30;
const RESUME_NOTE_TYPES = new Set<NoteType>(['attempt_log', 'checkpoint', 'general', 'handoff_note', 'attempt_failure', 'discovered_work']);

export class SessionService {
  constructor(
    private taskRepo: ITaskRepository,
    private goalRepo: IGoalRepository,
    private decisionRepo: IDecisionRepository,
    private taskLifecycleService: TaskLifecycleService,
    private noteRepo?: INoteRepository
  ) {}

  detectAgentStallsAndThrashing(projectPath?: string, workspaceId?: string): StallWarning[] {
    const activeTasks = this.taskRepo.list({ isArchived: false, workspaceId });
    const warnings: StallWarning[] = [];
    const now = Date.now();

    for (const t of activeTasks) {
      // 1. Thrashing: Attempt count >= 2
      if (t.attemptCount >= 2 && t.status !== 'done' && t.status !== 'dropped') {
        warnings.push({
          taskId: t.id,
          taskTitle: t.title,
          claimedByAgent: t.claimedByAgent,
          warningType: 'thrashing',
          message: `Task has failed ${t.attemptCount} consecutive automated attempts. Repeated code thrashing detected.`,
          suggestedAction: 'Decompose task into smaller subtasks or escalate to human for architectural clarification.',
        });
      }

      // 2. Excessive Reopens: Reopen count >= 2
      if (t.reopenCount >= 2) {
        warnings.push({
          taskId: t.id,
          taskTitle: t.title,
          claimedByAgent: t.claimedByAgent,
          warningType: 'excessive_reopens',
          message: `Task has been reopened ${t.reopenCount} times after previous closure. Verification criteria may be underspecified.`,
          suggestedAction: 'Review acceptance criteria and verify test cases before re-claiming.',
        });
      }

      // 3. Lease Stalled / Expired in 'doing' state
      if (t.status === 'doing') {
        if (t.leaseExpiresAt && new Date(t.leaseExpiresAt).getTime() < now) {
          warnings.push({
            taskId: t.id,
            taskTitle: t.title,
            claimedByAgent: t.claimedByAgent,
            warningType: 'lease_stalled',
            message: `Active task claim lease expired at ${t.leaseExpiresAt}. Agent may have crashed or stalled silently.`,
            suggestedAction: 'Release task or call moo_checkpoint to renew heartbeat.',
          });
        }
      }
    }

    return warnings;
  }

  whereDidILeaveOff(projectPath: string, agentId?: string, workspaceId?: string): SessionResumeSummary {
    const now = new Date();
    // 1. In-flight tasks: this agent's own, and ones whose holder is gone (a previous session)
    const doing = this.taskRepo.list({ status: 'doing', isArchived: false, workspaceId });
    const mine = agentId ? doing.filter((t) => t.claimedByAgent === agentId) : [];
    const abandonedDoingTasks = mine.length > 0 ? mine : doing;
    const currentTask = mine[0];
    // Still marked doing (lease monitor not run yet), or already returned to the queue by it.
    const requeued = this.taskRepo
      .list({ isArchived: false, workspaceId })
      .filter((t) => t.interruptedFrom && (t.status === 'todo' || t.status === 'blocked-on-dependency'));
    const interruptedTasks = [...doing.filter((t) => t.claimedByAgent !== agentId && !hasLiveLease(t, now)), ...requeued];

    // 2. Tasks waiting on human input
    const waitingOnHumanTasks = this.taskRepo.list({
      status: 'waiting-on-human',
      isArchived: false,
      workspaceId,
    });

    // 3. Ready unblocked tasks
    const activeGoals = workspaceId
      ? this.goalRepo.list(undefined, 'active', workspaceId)
      : this.goalRepo.list(projectPath, 'active');
    const unblockedReadyTasks = [];
    const nextUnblocked = this.taskLifecycleService.getNextUnblockedTask(undefined, agentId, false, workspaceId);
    if (nextUnblocked) {
      unblockedReadyTasks.push(nextUnblocked);
    }

    // 4. Settled decisions
    const settledDecisions = workspaceId
      ? this.decisionRepo.list(undefined, 'accepted', undefined, workspaceId)
      : this.decisionRepo.list(projectPath, 'accepted');

    // 5. Orphan tasks (scope drift)
    const orphanTasks = this.taskRepo.listOrphanTasks(workspaceId);

    // 6. The goal this session is most likely working on, and goals whose work is all finished
    const open = this.taskRepo
      .list({ isArchived: false, workspaceId })
      .filter((t) => OPEN_STATUSES.includes(t.status));
    const recentOpen = [...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const focusGoalId =
      currentTask?.goalId ||
      interruptedTasks[0]?.goalId ||
      recentOpen.find((t) => t.goalId && activeGoals.some((g) => g.id === t.goalId && g.title !== ADHOC_GOAL_TITLE))?.goalId ||
      activeGoals.find((g) => g.title !== ADHOC_GOAL_TITLE)?.id ||
      activeGoals[0]?.id;
    const focusGoal = activeGoals.find((g) => g.id === focusGoalId);
    const progress = (goalId: string) => {
      const tasks = this.taskRepo.listByGoalId(goalId).filter((t) => !t.isArchived && t.status !== 'dropped');
      return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length };
    };
    const goalsReadyToClose = activeGoals.filter((g) => {
      if (g.title === ADHOC_GOAL_TITLE) return false;
      const p = progress(g.id);
      return p.total > 0 && p.done === p.total;
    });

    return {
      abandonedDoingTasks,
      waitingOnHumanTasks,
      unblockedReadyTasks,
      settledDecisions,
      activeGoals,
      orphanTasks,
      currentTask,
      interruptedTasks,
      focusGoal: focusGoal ? { ...focusGoal, progress: progress(focusGoal.id) } : undefined,
      goalsReadyToClose,
      staleTasks: this.findStaleTasks(workspaceId, projectPath, now),
    };
  }

  /**
   * Backlog that has probably gone off: todo work untouched for STALE_TODO_DAYS, deferred work for
   * STALE_DEFERRED_DAYS, and open tasks none of whose declared files exist in this project.
   */
  findStaleTasks(workspaceId?: string, projectPath?: string, now: Date = new Date()): StaleTask[] {
    const days = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;
    const stale: StaleTask[] = [];
    for (const t of this.taskRepo.list({ isArchived: false, workspaceId })) {
      if (!['todo', 'blocked-on-dependency'].includes(t.status) || t.interruptedFrom) continue;
      const age = days(t.updatedAt);
      if (t.isDeferred && age >= STALE_DEFERRED_DAYS) {
        stale.push({ task: t, reason: `deferred and untouched for ${Math.floor(age)} days` });
      } else if (!t.isDeferred && age >= STALE_TODO_DAYS) {
        stale.push({ task: t, reason: `untouched for ${Math.floor(age)} days` });
      } else if (projectPath && fs.existsSync(projectPath) && t.declaredFiles?.length) {
        const exists = t.declaredFiles.some((f) => fs.existsSync(path.resolve(projectPath, f)));
        // New files are fine to declare; only flag when not even their directories exist here.
        const dirsExist = t.declaredFiles.some((f) => fs.existsSync(path.dirname(path.resolve(projectPath, f))));
        if (!exists && !dirsExist) stale.push({ task: t, reason: 'none of its declared files or folders exist in this project' });
      }
    }
    return stale;
  }

  /** Progress notes worth reading on resume: the agent's own words, not claim bookkeeping. */
  recentNotesFor(taskId: string, limit = 3): TaskNote[] {
    if (!this.noteRepo) return [];
    return this.noteRepo
      .listByTaskId(taskId)
      .filter((n) => RESUME_NOTE_TYPES.has(n.noteType) && !/^Claimed task \(Attempt/.test(n.content))
      .slice(-limit);
  }

  getCompactContext(
    projectPath: string,
    agentId?: string,
    verbosity: 'ultra-dense' | 'standard' | 'full' = 'standard',
    workspaceId?: string,
    webUiUrl?: string
  ): string {
    const summary = this.whereDidILeaveOff(projectPath, agentId, workspaceId);
    const myDoing = summary.currentTask || (agentId ? undefined : summary.abandonedDoingTasks[0]);
    const goal = summary.focusGoal;
    const oneLine = (text: string, max: number) => {
      const flat = text.replace(/\s+/g, ' ').trim();
      return flat.length > max ? `${flat.slice(0, max)}…` : flat;
    };

    if (verbosity === 'ultra-dense') {
      const parts: string[] = ['[MOO CONTEXT]'];
      if (goal) parts.push(`Goal: [${goal.id}] ${goal.title} (${goal.progress.done}/${goal.progress.total})`);
      if (myDoing) {
        parts.push(`Task: [${myDoing.id}] ${myDoing.title} (${oneLine(myDoing.acceptanceCriteria, 160)})`);
        const last = this.recentNotesFor(myDoing.id, 1)[0];
        if (last) parts.push(`Last note: ${oneLine(last.content, 160)}`);
      } else if (summary.interruptedTasks.length > 0) {
        const t = summary.interruptedTasks[0];
        parts.push(`Interrupted: [${t.id}] ${t.title} (resume with moo_claim_task)`);
      } else if (summary.unblockedReadyTasks.length > 0) {
        parts.push(`Ready: [${summary.unblockedReadyTasks[0].id}] ${summary.unblockedReadyTasks[0].title}`);
      }
      if (summary.settledDecisions.length > 0) {
        parts.push(`ADRs: ${summary.settledDecisions.slice(0, 2).map((d) => `${d.title}->${oneLine(d.choice, 80)}`).join('; ')}`);
      }
      return parts.join(' | ');
    }

    const full = verbosity === 'full';
    const lines: string[] = ['# 🐮 MOO TASKS CONTEXT'];
    if (webUiUrl) lines.push(`Board: ${webUiUrl}`);
    const pushNotes = (taskId: string) => {
      const notes = this.recentNotesFor(taskId, full ? 5 : 3);
      if (notes.length === 0) return;
      lines.push('- *Recent notes*:');
      for (const n of notes) lines.push(`  - ${n.createdAt.slice(0, 16).replace('T', ' ')}: ${oneLine(n.content, full ? 600 : 300)}`);
    };
    const pushChecklist = (task: Task) => {
      lines.push(`- *Criteria*:${task.acceptanceCriteria.includes('\n') ? '' : ' ' + (task.acceptanceCriteria || 'None declared')}`);
      if (task.acceptanceCriteria.includes('\n')) {
        for (const line of task.acceptanceCriteria.split('\n').filter((l) => l.trim())) lines.push(`  ${line.trim()}`);
      }
    };

    // 1. The goal in focus
    if (goal) {
      lines.push('\n## 🎯 ACTIVE GOAL');
      lines.push(`- **[${goal.id}]**: ${goal.title} — ${goal.progress.done}/${goal.progress.total} tasks done`);
      if (goal.verbatimPrompt) lines.push(`- *Prompt*: "${oneLine(goal.verbatimPrompt, full ? 500 : 180)}"`);
      if (full && goal.description) lines.push(`- *PRD*: ${goal.description.slice(0, 300)}...`);
      const others = summary.activeGoals.filter((g) => g.id !== goal.id && g.title !== ADHOC_GOAL_TITLE);
      if (others.length > 0) lines.push(`- *Other active goals*: ${others.slice(0, 5).map((g) => `[${g.id}] ${g.title}`).join(', ')}`);
    }

    // 2. This agent's claimed task, with where it left off
    if (myDoing) {
      lines.push('\n## ⚡ CURRENT CLAIMED TASK');
      lines.push(`- **[${myDoing.id}]** (${myDoing.priority}): ${myDoing.title}`);
      pushChecklist(myDoing);
      if (myDoing.declaredFiles && myDoing.declaredFiles.length > 0) {
        lines.push(`- *Declared Files*: ${myDoing.declaredFiles.join(', ')}`);
      }
      if (myDoing.leaseExpiresAt) lines.push(`- *Lease Expires*: ${myDoing.leaseExpiresAt}`);
      if (full && myDoing.description) lines.push(`- *Description*: ${myDoing.description}`);
      pushNotes(myDoing.id);
    }

    // 3. Work a previous session left mid-way
    if (summary.interruptedTasks.length > 0) {
      lines.push('\n## ⏸ INTERRUPTED WORK (holder gone; resume with moo_claim_task, which keeps its git baseline)');
      for (const t of summary.interruptedTasks.slice(0, full ? 10 : 3)) {
        lines.push(`- **[${t.id}]** (${t.priority}): ${t.title} — was held by ${t.claimedByAgent || t.interruptedFrom || 'unknown'}`);
        if (t === summary.interruptedTasks[0]) {
          pushChecklist(t);
          pushNotes(t.id);
        }
      }
    }

    // 4. Next ready task when nothing is in hand
    if (!myDoing && summary.unblockedReadyTasks[0]) {
      const nextTask = summary.unblockedReadyTasks[0];
      lines.push('\n## 📋 READY UNBLOCKED TASK');
      lines.push(`- **[${nextTask.id}]** (${nextTask.priority}): ${nextTask.title}`);
      pushChecklist(nextTask);
    }

    // 5. Waiting on Human Alerts
    if (summary.waitingOnHumanTasks && summary.waitingOnHumanTasks.length > 0) {
      lines.push('\n## 🙋 WAITING ON HUMAN');
      summary.waitingOnHumanTasks.slice(0, full ? 10 : 3).forEach((t) => {
        lines.push(`- **[${t.id}]**: ${t.title}`);
      });
    }

    // 6. Goals whose tasks are all done
    if (summary.goalsReadyToClose.length > 0) {
      lines.push('\n## ✅ GOALS READY TO CLOSE');
      for (const g of summary.goalsReadyToClose.slice(0, 5)) {
        lines.push(`- **[${g.id}]** ${g.title} — all tasks done; moo_update_goal(goalId, status: 'completed') writes its summary`);
      }
    }

    // 7. Settled Decisions
    if (summary.settledDecisions && summary.settledDecisions.length > 0) {
      lines.push('\n## 🏛️ SETTLED DECISIONS (ADR)');
      summary.settledDecisions.slice(0, full ? 10 : 3).forEach((d) => {
        lines.push(`- **${d.title}**: ${oneLine(d.choice, 200)} (*${oneLine(d.rationale, 120)}*)`);
      });
    }

    // 8. Active File Locks held by other agents
    const locks = summary.abandonedDoingTasks
      .filter((t) => t !== myDoing && t.declaredFiles && t.declaredFiles.length > 0 && hasLiveLease(t))
      .map((t) => `- \`${t.declaredFiles.join(', ')}\` (held by ${t.claimedByAgent || 'agent'})`);
    if (locks.length > 0) {
      lines.push('\n## 🔒 ACTIVE FILE LOCKS');
      lines.push(...locks);
    }

    // 9. Stale backlog
    if (summary.staleTasks.length > 0) {
      lines.push(`\n## 🧹 STALE BACKLOG (${summary.staleTasks.length}; drop, reschedule or move them)`);
      for (const { task, reason } of summary.staleTasks.slice(0, full ? 10 : 3)) {
        lines.push(`- **[${task.id}]** ${task.title} — ${reason}`);
      }
    }

    // 10. Stall & Thrash Early Warnings
    const stallWarnings = this.detectAgentStallsAndThrashing(projectPath, workspaceId);
    if (stallWarnings.length > 0) {
      lines.push('\n## ⚠️ AGENT STALL & THRASH WARNINGS');
      stallWarnings.slice(0, 3).forEach((w) => {
        lines.push(`- **[${w.taskId}]** ${w.message} (*Action*: ${w.suggestedAction})`);
      });
    }

    return lines.join('\n');
  }

  getFileContext(filePaths: string[], projectPath?: string, workspaceId?: string): FileContextSummary {
    const normalize = (p: string) =>
      p.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');

    const normalizedInputs = filePaths.map(normalize);

    const matchesFile = (f: string): boolean => {
      const nf = normalize(f);
      const base = nf.split('/').pop() || '';
      return normalizedInputs.some((inp) => {
        const inpBase = inp.split('/').pop() || '';
        return (
          nf === inp ||
          nf.endsWith('/' + inp) ||
          inp.endsWith('/' + nf) ||
          (base.length > 3 && base === inpBase)
        );
      });
    };

    // 1. Active Locks (tasks in 'doing' whose declaredFiles match)
    const activeDoingTasks = this.taskRepo.list({ status: 'doing', isArchived: false, workspaceId });
    const activeLocks = activeDoingTasks
      .filter((t) => (t.declaredFiles || []).some(matchesFile))
      .map((t) => ({
        taskId: t.id,
        taskTitle: t.title,
        claimedByAgent: t.claimedByAgent,
        declaredFiles: t.declaredFiles,
        leaseExpiresAt: t.leaseExpiresAt,
      }));

    // 2. Past completed tasks that touched these files
    const allCompletedTasks = this.taskRepo.list({ status: 'done', isArchived: false, workspaceId });
    const pastTasks = allCompletedTasks
      .filter((t) => {
        const allFiles = [
          ...(t.declaredFiles || []),
          ...(t.evidence?.filesModified || []),
        ];
        return allFiles.some(matchesFile);
      })
      .slice(0, 10);

    // 3. Relevant Decisions
    const allDecisions = workspaceId
      ? this.decisionRepo.list(undefined, 'accepted', undefined, workspaceId)
      : this.decisionRepo.list(projectPath || '', 'accepted');
    const relevantDecisions = allDecisions.filter((dec) => {
      const textToSearch = [
        dec.title,
        ...(dec.tags || []),
        dec.choice,
        dec.rationale,
      ]
        .join(' ')
        .toLowerCase();

      return normalizedInputs.some((inp) => {
        const parts = inp.split('/').filter((p) => p.length > 2);
        return parts.some((part) => {
          const cleanPart = part.replace(/\.[a-z0-9]+$/i, '');
          return cleanPart.length > 2 && textToSearch.includes(cleanPart);
        });
      });
    });

    // 4. Recent Notes from matching tasks
    const recentNotes: Array<{
      taskId: string;
      noteType: string;
      content: string;
      createdAt: string;
      authorId: string;
    }> = [];

    if (this.noteRepo) {
      const candidateTaskIds = new Set([
        ...activeLocks.map((l) => l.taskId),
        ...pastTasks.map((t) => t.id),
      ]);

      for (const tid of candidateTaskIds) {
        const taskNotes = this.noteRepo.listByTaskId(tid);
        for (const n of taskNotes) {
          recentNotes.push({
            taskId: n.taskId,
            noteType: n.noteType,
            content: n.content,
            createdAt: n.createdAt,
            authorId: n.authorId,
          });
        }
      }
    }

    recentNotes.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
      filePaths,
      activeLocks,
      pastTasks,
      relevantDecisions,
      recentNotes: recentNotes.slice(0, 15),
    };
  }
}
