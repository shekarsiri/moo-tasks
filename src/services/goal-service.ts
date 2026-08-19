import crypto from 'crypto';
import {
  Goal,
  GoalStatus,
  GoalStatusSummary,
  Task,
} from '../domain/types.js';
import { GoalCapExceededError, GoalNotFoundError, MandatoryReasonMissingError } from '../domain/errors.js';
import { IGoalRepository, ITaskRepository } from '../infrastructure/repositories/interfaces.js';

export class GoalService {
  constructor(
    private goalRepo: IGoalRepository,
    private taskRepo: ITaskRepository
  ) {}

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
      task.claimedByAgent = undefined;
      task.claimedSessionId = undefined;
      task.leaseExpiresAt = undefined;
      this.taskRepo.update(task);
    }

    return { goal, droppedTaskCount: openTasks.length };
  }

  reopenGoal(goalId: string, authorId: string, reopenTasks: boolean = true): Goal {
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
        task.status = 'todo';
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
