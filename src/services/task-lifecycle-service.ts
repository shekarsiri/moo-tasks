import crypto from 'crypto';
import {
  AuthorType,
  StatusHistoryEntry,
  Task,
  TaskPriority,
  TaskStatus,
} from '../domain/types.js';
import {
  MandatoryReasonMissingError,
  ParentHasOpenSubtasksError,
  SubtaskNestingError,
  TaskNotFoundError,
} from '../domain/errors.js';
import { DependencyGraph } from '../domain/dependency.js';
import { DuplicateMatch, TaskSimilarityDetector } from '../domain/similarity.js';
import {
  ITaskRepository,
  IStatusHistoryRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';
import { GoalService } from './goal-service.js';

export interface CreateTaskDTO {
  title: string;
  description?: string;
  goalId?: string;
  parentId?: string;
  priority?: TaskPriority;
  acceptanceCriteria: string;
  dependsOnTaskIds?: string[];
  declaredFiles?: string[];
  idempotencyKey?: string;
  isDeferred?: boolean;
}

export interface CreateTaskResult {
  task: Task;
  isDuplicate: boolean;
  duplicateWarnings: DuplicateMatch[];
}

export class TaskLifecycleService {
  constructor(
    private taskRepo: ITaskRepository,
    private statusHistoryRepo: IStatusHistoryRepository,
    private noteRepo: INoteRepository,
    private goalService: GoalService
  ) {}

  createTask(dto: CreateTaskDTO, authorId: string = 'system', authorType: AuthorType = 'system'): CreateTaskResult {
    // 1. Check idempotency
    if (dto.idempotencyKey) {
      const existing = this.taskRepo.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        return { task: existing, isDuplicate: false, duplicateWarnings: [] };
      }
    }

    // 2. Check Goal open task cap
    if (dto.goalId) {
      this.goalService.checkGoalCap(dto.goalId);
    }

    // 3. Subtask 1-level limit validation
    if (dto.parentId) {
      const parent = this.taskRepo.findById(dto.parentId);
      if (!parent) {
        throw new TaskNotFoundError(dto.parentId);
      }
      if (parent.parentId) {
        throw new SubtaskNestingError(dto.parentId);
      }
    }

    // 4. Duplicate similarity check
    const existingTasks = this.taskRepo.list();
    const duplicateWarnings = TaskSimilarityDetector.findPotentialDuplicates(dto.title, existingTasks);

    // 5. Dependency cycle validation
    if (dto.dependsOnTaskIds && dto.dependsOnTaskIds.length > 0) {
      const existingDeps = this.taskRepo.getAllDependencies();
      const tempId = 'candidate-task-id';
      DependencyGraph.validateNoCycles(existingDeps, tempId, dto.dependsOnTaskIds);
    }

    const now = new Date().toISOString();
    const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

    const task: Task = {
      id: taskId,
      goalId: dto.goalId,
      parentId: dto.parentId,
      title: dto.title.trim(),
      description: dto.description?.trim(),
      status: 'todo',
      priority: dto.priority || 'medium',
      orderIndex: existingTasks.length + 1,
      acceptanceCriteria: dto.acceptanceCriteria?.trim() || 'Criteria not specified',
      declaredFiles: dto.declaredFiles || [],
      verificationState: 'unverified',
      attemptCount: 0,
      closeCount: 0,
      reopenCount: 0,
      maxAttemptsAllowed: 3,
      isDeferred: Boolean(dto.isDeferred),
      idempotencyKey: dto.idempotencyKey,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastStateChangeAt: now,
    };

    // If initial dependencies are not all done, start as blocked-on-dependency
    if (dto.dependsOnTaskIds && dto.dependsOnTaskIds.length > 0) {
      const taskMap = new Map(existingTasks.map((t) => [t.id, t]));
      const allDeps = dto.dependsOnTaskIds.map((id) => ({ taskId, dependsOnTaskId: id, createdAt: now }));
      const isUnblocked = DependencyGraph.isTaskUnblocked(taskId, allDeps, taskMap);
      if (!isUnblocked) {
        task.status = 'blocked-on-dependency';
        task.blockedReason = `Waiting on blocker tasks: ${dto.dependsOnTaskIds.join(', ')}`;
      }
    }

    const created = this.taskRepo.create(task);

    // Save dependencies
    if (dto.dependsOnTaskIds) {
      for (const depId of dto.dependsOnTaskIds) {
        this.taskRepo.addDependency(taskId, depId);
      }
    }

    // Record initial status in history
    this.recordStatusHistory(taskId, 'todo', task.status, authorId, authorType, 'Task created');

    return {
      task: created,
      isDuplicate: false,
      duplicateWarnings,
    };
  }

  createBatch(dtos: CreateTaskDTO[], authorId: string = 'system', authorType: AuthorType = 'system'): CreateTaskResult[] {
    const results: CreateTaskResult[] = [];
    for (const dto of dtos) {
      results.push(this.createTask(dto, authorId, authorType));
    }
    return results;
  }

  getTask(taskId: string): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  updateTask(
    taskId: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'acceptanceCriteria' | 'declaredFiles'>>
  ): Task {
    const task = this.getTask(taskId);
    const now = new Date().toISOString();

    if (updates.title !== undefined) task.title = updates.title.trim();
    if (updates.description !== undefined) task.description = updates.description.trim();
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.acceptanceCriteria !== undefined) task.acceptanceCriteria = updates.acceptanceCriteria.trim();
    if (updates.declaredFiles !== undefined) task.declaredFiles = updates.declaredFiles;

    task.updatedAt = now;
    return this.taskRepo.update(task);
  }

  transitionStatus(
    taskId: string,
    newStatus: TaskStatus,
    authorId: string,
    authorType: AuthorType,
    reason?: string
  ): Task {
    const task = this.getTask(taskId);
    if (task.status === newStatus) return task;

    // Rule: Cannot close parent if subtasks are open
    if (newStatus === 'done') {
      const subtasks = this.taskRepo.listSubtasks(taskId);
      const openSubtasks = subtasks.filter((s) => ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(s.status));
      if (openSubtasks.length > 0) {
        throw new ParentHasOpenSubtasksError(taskId, openSubtasks.length);
      }
    }

    // Rule: Dropping requires mandatory reason
    if (newStatus === 'dropped' && (!reason || !reason.trim())) {
      throw new MandatoryReasonMissingError('dropping a task');
    }

    const previousStatus = task.status;
    const now = new Date().toISOString();

    task.status = newStatus;
    task.lastStateChangeAt = now;
    task.updatedAt = now;

    if (newStatus === 'done') {
      task.completedAt = now;
      task.closeCount += 1;
      task.claimedByAgent = undefined;
      task.claimedSessionId = undefined;
      task.leaseExpiresAt = undefined;
    } else if (newStatus === 'dropped') {
      task.droppedReason = reason?.trim();
      task.claimedByAgent = undefined;
      task.claimedSessionId = undefined;
      task.leaseExpiresAt = undefined;
    }

    const updated = this.taskRepo.update(task);
    this.recordStatusHistory(taskId, previousStatus, newStatus, authorId, authorType, reason);

    // Auto-resolve dependents when completing or dropping a blocker
    if (newStatus === 'done' || newStatus === 'dropped') {
      this.resolveDependents(taskId, authorId);
    }

    return updated;
  }

  private resolveDependents(finishedTaskId: string, authorId: string): void {
    const dependentTaskIds = this.taskRepo.getDependents(finishedTaskId);
    if (dependentTaskIds.length === 0) return;

    const allTasks = this.taskRepo.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const allDeps = this.taskRepo.getAllDependencies();

    for (const depId of dependentTaskIds) {
      const depTask = taskMap.get(depId);
      if (depTask && depTask.status === 'blocked-on-dependency') {
        const isUnblocked = DependencyGraph.isTaskUnblocked(depId, allDeps, taskMap);
        if (isUnblocked) {
          depTask.status = 'todo';
          depTask.blockedReason = undefined;
          depTask.updatedAt = new Date().toISOString();
          depTask.lastStateChangeAt = new Date().toISOString();
          this.taskRepo.update(depTask);
          this.recordStatusHistory(
            depId,
            'blocked-on-dependency',
            'todo',
            'system',
            'system',
            `Auto-unblocked: Dependency ${finishedTaskId} completed`
          );
        }
      }
    }
  }

  getNextUnblockedTask(goalId?: string, agentId?: string): Task | null {
    const filter: any = { status: 'todo', isDeferred: false, isArchived: false };
    if (goalId) filter.goalId = goalId;

    const candidateTasks = this.taskRepo.list(filter);
    if (candidateTasks.length === 0) return null;

    const allTasks = this.taskRepo.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const allDeps = this.taskRepo.getAllDependencies();

    // Priority ordering
    const priorityWeight: Record<TaskPriority, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const unblockedTasks = candidateTasks.filter((t) =>
      DependencyGraph.isTaskUnblocked(t.id, allDeps, taskMap)
    );

    if (unblockedTasks.length === 0) return null;

    unblockedTasks.sort((a, b) => {
      const pDiff = (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
      if (pDiff !== 0) return pDiff;
      return a.orderIndex - b.orderIndex;
    });

    return unblockedTasks[0];
  }

  dropTask(taskId: string, reason: string, authorId: string, authorType: AuthorType = 'agent'): Task {
    if (!reason || !reason.trim()) {
      throw new MandatoryReasonMissingError('dropping task');
    }
    const task = this.transitionStatus(taskId, 'dropped', authorId, authorType, reason);
    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType,
      authorId,
      noteType: 'drop_reason',
      content: `Task dropped: ${reason.trim()}`,
      createdAt: new Date().toISOString(),
    });
    return task;
  }

  reopenTask(taskId: string, reason?: string, authorId: string = 'human', authorType: AuthorType = 'human'): Task {
    const task = this.getTask(taskId);
    const now = new Date().toISOString();
    const prevStatus = task.status;

    task.status = 'todo';
    task.reopenCount += 1;
    task.droppedReason = undefined;
    task.completedAt = undefined;
    task.verificationState = 'unverified';
    task.rejectionReason = undefined;
    task.updatedAt = now;
    task.lastStateChangeAt = now;

    const updated = this.taskRepo.update(task);
    this.recordStatusHistory(taskId, prevStatus, 'todo', authorId, authorType, reason || 'Task reopened');

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType,
      authorId,
      noteType: 'reopen_reason',
      content: `Task reopened (reopen #${task.reopenCount}): ${reason || 'No reason specified'}`,
      createdAt: now,
    });

    return updated;
  }

  undoStatusChange(taskId: string, authorId: string, authorType: AuthorType): Task {
    const previousEntry = this.statusHistoryRepo.findPreviousState(taskId);
    if (!previousEntry) {
      throw new Error(`No previous status history found to undo for task ${taskId}`);
    }

    const task = this.getTask(taskId);
    const currentStatus = task.status;
    task.status = previousEntry.fromStatus;
    task.updatedAt = new Date().toISOString();
    task.lastStateChangeAt = new Date().toISOString();

    const updated = this.taskRepo.update(task);
    this.recordStatusHistory(
      taskId,
      currentStatus,
      task.status,
      authorId,
      authorType,
      `Undid transition from ${currentStatus} back to ${task.status}`
    );
    return updated;
  }

  bulkDrop(taskIds: string[], reason: string, authorId: string, authorType: AuthorType = 'human'): number {
    let count = 0;
    for (const id of taskIds) {
      this.dropTask(id, reason, authorId, authorType);
      count++;
    }
    return count;
  }

  bulkReopen(taskIds: string[], reason: string, authorId: string, authorType: AuthorType = 'human'): number {
    let count = 0;
    for (const id of taskIds) {
      this.reopenTask(id, reason, authorId, authorType);
      count++;
    }
    return count;
  }

  reorderTasks(updates: { id: string; orderIndex: number }[]): void {
    this.taskRepo.updateOrderIndices(updates);
  }

  private recordStatusHistory(
    taskId: string,
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    changedBy: string,
    authorType: AuthorType,
    reason?: string
  ): void {
    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus,
      toStatus,
      changedBy,
      authorType,
      reason,
      timestamp: new Date().toISOString(),
    });
  }
}
