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
}
