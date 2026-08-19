import { Decision, SessionResumeSummary, Task } from '../domain/types.js';
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

export class SessionService {
  constructor(
    private taskRepo: ITaskRepository,
    private goalRepo: IGoalRepository,
    private decisionRepo: IDecisionRepository,
    private taskLifecycleService: TaskLifecycleService,
    private noteRepo?: INoteRepository
  ) {}

  detectAgentStallsAndThrashing(projectPath?: string): StallWarning[] {
    const activeTasks = this.taskRepo.list({ isArchived: false });
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

  whereDidILeaveOff(projectPath: string, agentId?: string): SessionResumeSummary {
    // 1. Abandoned or in-flight doing tasks
    const doingFilter: any = { status: 'doing', isArchived: false };
    if (agentId) doingFilter.claimedByAgent = agentId;
    const abandonedDoingTasks = this.taskRepo.list(doingFilter);

    // 2. Tasks waiting on human input
    const waitingOnHumanTasks = this.taskRepo.list({
      status: 'waiting-on-human',
      isArchived: false,
    });

    // 3. Ready unblocked tasks
    const activeGoals = this.goalRepo.list(projectPath, 'active');
    const unblockedReadyTasks = [];

    // Check top ready tasks across goals or project
    const nextUnblocked = this.taskLifecycleService.getNextUnblockedTask();
    if (nextUnblocked) {
      unblockedReadyTasks.push(nextUnblocked);
    }

    // 4. Settled decisions
    const settledDecisions = this.decisionRepo.list(projectPath, 'accepted');

    // 5. Orphan tasks (scope drift)
    const orphanTasks = this.taskRepo.listOrphanTasks();

    return {
      abandonedDoingTasks,
      waitingOnHumanTasks,
      unblockedReadyTasks,
      settledDecisions,
      activeGoals,
      orphanTasks,
    };
  }

  getCompactContext(
    projectPath: string,
    agentId?: string,
    verbosity: 'ultra-dense' | 'standard' | 'full' = 'standard'
  ): string {
    const summary = this.whereDidILeaveOff(projectPath, agentId);

    if (verbosity === 'ultra-dense') {
      const parts: string[] = ['[MOO CONTEXT]'];
      if (summary.activeGoals && summary.activeGoals.length > 0) {
        parts.push(`Goal: [${summary.activeGoals[0].id}] ${summary.activeGoals[0].title}`);
      }
      const myDoing = agentId
        ? summary.abandonedDoingTasks.find((t) => t.claimedByAgent === agentId)
        : summary.abandonedDoingTasks[0];
      if (myDoing) {
        parts.push(`Task: [${myDoing.id}] ${myDoing.title} (${myDoing.acceptanceCriteria})`);
      } else if (summary.unblockedReadyTasks.length > 0) {
        parts.push(`Ready: [${summary.unblockedReadyTasks[0].id}] ${summary.unblockedReadyTasks[0].title}`);
      }
      if (summary.settledDecisions.length > 0) {
        parts.push(`ADRs: ${summary.settledDecisions.slice(0, 2).map((d) => `${d.title}->${d.choice}`).join('; ')}`);
      }
      return parts.join(' | ');
    }

    const lines: string[] = ['# 🐮 MOO TASKS CONTEXT'];

    // 1. Active Goal
    if (summary.activeGoals && summary.activeGoals.length > 0) {
      const topGoal = summary.activeGoals[0];
      lines.push('\n## 🎯 ACTIVE GOAL');
      lines.push(`- **[${topGoal.id}]**: ${topGoal.title}`);
      if (topGoal.verbatimPrompt) {
        const sliceLen = verbosity === 'full' ? 500 : 180;
        lines.push(`- *Prompt*: "${topGoal.verbatimPrompt.slice(0, sliceLen)}"`);
      }
      if (verbosity === 'full' && topGoal.description) {
        lines.push(`- *PRD*: ${topGoal.description.slice(0, 300)}...`);
      }
    }

    // 2. In-Flight Claimed Task
    const myDoing = agentId
      ? summary.abandonedDoingTasks.find((t) => t.claimedByAgent === agentId)
      : summary.abandonedDoingTasks[0];

    if (myDoing) {
      lines.push('\n## ⚡ CURRENT CLAIMED TASK');
      lines.push(`- **[${myDoing.id}]** (${myDoing.priority}): ${myDoing.title}`);
      lines.push(`- *Criteria*: ${myDoing.acceptanceCriteria || 'None declared'}`);
      if (myDoing.declaredFiles && myDoing.declaredFiles.length > 0) {
        lines.push(`- *Declared Files*: ${myDoing.declaredFiles.join(', ')}`);
      }
      if (myDoing.leaseExpiresAt) {
        lines.push(`- *Lease Expires*: ${myDoing.leaseExpiresAt}`);
      }
      if (verbosity === 'full' && myDoing.description) {
        lines.push(`- *Description*: ${myDoing.description}`);
      }
    } else {
      // Top unblocked
      const nextTask = summary.unblockedReadyTasks[0];
      if (nextTask) {
        lines.push('\n## 📋 READY UNBLOCKED TASK');
        lines.push(`- **[${nextTask.id}]** (${nextTask.priority}): ${nextTask.title}`);
        lines.push(`- *Criteria*: ${nextTask.acceptanceCriteria}`);
      }
    }

    // 3. Waiting on Human Alerts
    if (summary.waitingOnHumanTasks && summary.waitingOnHumanTasks.length > 0) {
      lines.push('\n## 🙋 WAITING ON HUMAN');
      summary.waitingOnHumanTasks.slice(0, verbosity === 'full' ? 10 : 3).forEach((t) => {
        lines.push(`- **[${t.id}]**: ${t.title}`);
      });
    }

    // 4. Settled Decisions
    if (summary.settledDecisions && summary.settledDecisions.length > 0) {
      lines.push('\n## 🏛️ SETTLED DECISIONS (ADR)');
      summary.settledDecisions.slice(0, verbosity === 'full' ? 10 : 3).forEach((d) => {
        lines.push(`- **${d.title}**: ${d.choice} (*${d.rationale.slice(0, 120)}*)`);
      });
    }

    // 5. Active File Locks across all active tasks
    const activeTasks = summary.abandonedDoingTasks;
    const locks: string[] = [];
    activeTasks.forEach((t) => {
      if (t.declaredFiles && t.declaredFiles.length > 0) {
        locks.push(`- \`${t.declaredFiles.join(', ')}\` (held by ${t.claimedByAgent || 'agent'})`);
      }
    });
    if (locks.length > 0) {
      lines.push('\n## 🔒 ACTIVE FILE LOCKS');
      lines.push(...locks);
    }

    // 6. Stall & Thrash Early Warnings
    const stallWarnings = this.detectAgentStallsAndThrashing(projectPath);
    if (stallWarnings.length > 0) {
      lines.push('\n## ⚠️ AGENT STALL & THRASH WARNINGS');
      stallWarnings.slice(0, 3).forEach((w) => {
        lines.push(`- **[${w.taskId}]** ${w.message} (*Action*: ${w.suggestedAction})`);
      });
    }

    return lines.join('\n');
  }

  getFileContext(filePaths: string[], projectPath?: string): FileContextSummary {
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
    const activeDoingTasks = this.taskRepo.list({ status: 'doing', isArchived: false });
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
    const allCompletedTasks = this.taskRepo.list({ status: 'done', isArchived: false });
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
    const allDecisions = this.decisionRepo.list(projectPath || '', 'accepted');
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
