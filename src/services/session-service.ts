import { SessionResumeSummary } from '../domain/types.js';
import {
  ITaskRepository,
  IGoalRepository,
  IDecisionRepository,
} from '../infrastructure/repositories/interfaces.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';

export class SessionService {
  constructor(
    private taskRepo: ITaskRepository,
    private goalRepo: IGoalRepository,
    private decisionRepo: IDecisionRepository,
    private taskLifecycleService: TaskLifecycleService
  ) {}

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

  getCompactContext(projectPath: string, agentId?: string): string {
    const summary = this.whereDidILeaveOff(projectPath, agentId);
    const lines: string[] = ['# 🐮 MOO TASKS CONTEXT'];

    // 1. Active Goal
    if (summary.activeGoals && summary.activeGoals.length > 0) {
      const topGoal = summary.activeGoals[0];
      lines.push('\n## 🎯 ACTIVE GOAL');
      lines.push(`- **[${topGoal.id}]**: ${topGoal.title}`);
      if (topGoal.verbatimPrompt) {
        lines.push(`- *Prompt*: "${topGoal.verbatimPrompt.slice(0, 180)}"`);
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
      summary.waitingOnHumanTasks.slice(0, 3).forEach((t) => {
        lines.push(`- **[${t.id}]**: ${t.title}`);
      });
    }

    // 4. Settled Decisions
    if (summary.settledDecisions && summary.settledDecisions.length > 0) {
      lines.push('\n## 🏛️ SETTLED DECISIONS (ADR)');
      summary.settledDecisions.slice(0, 3).forEach((d) => {
        lines.push(`- **${d.title}**: ${d.choice} (*${d.rationale.slice(0, 80)}*)`);
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

    return lines.join('\n');
  }
}
