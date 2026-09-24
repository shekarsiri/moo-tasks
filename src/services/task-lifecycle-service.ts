import crypto from 'crypto';
import {
  AuthorType,
  StatusHistoryEntry,
  Task,
  TaskNote,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../domain/types.js';
import {
  MandatoryReasonMissingError,
  ParentHasOpenSubtasksError,
  SubtaskNestingError,
  TaskNotFoundError,
} from '../domain/errors.js';
import { DependencyGraph } from '../domain/dependency.js';
import { FileConflictDetector } from '../domain/conflict.js';
import { DuplicateMatch, TaskSimilarityDetector } from '../domain/similarity.js';
import { TaskTitleSanitizer } from '../domain/title-sanitizer.js';
import {
  ITaskRepository,
  IStatusHistoryRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';
import { GoalService } from './goal-service.js';
import {
  clearClaim,
  openBlockerIds,
  reblockDependents,
  recordHistory,
  resolveDependents,
  returnToQueue,
  unblockIfReady,
} from './task-state.js';

export interface CreateTaskDTO {
  title: string;
  workspaceId?: string;
  description?: string;
  goalId?: string;
  parentId?: string;
  type?: TaskType;
  tags?: string[];
  priority?: TaskPriority;
  acceptanceCriteria: string;
  dependsOnTaskIds?: string[];
  declaredFiles?: string[];
  idempotencyKey?: string;
  isDeferred?: boolean;
  claimedByAgent?: string;
}

export interface CreateTaskResult {
  task: Task;
  isDuplicate: boolean;
  duplicateWarnings: DuplicateMatch[];
}

export interface LogAttemptFailureDTO {
  taskId: string;
  agentId: string;
  errorSnippet: string;
  failureCategory?: string;
  hypothesis?: string;
  nextAttemptPlan?: string;
}

export interface LogAttemptFailureResult {
  task: Task;
  attemptCount: number;
  autoEscalatedToHuman: boolean;
  note: TaskNote;
}

export class TaskLifecycleService {
  constructor(
    private taskRepo: ITaskRepository,
    private statusHistoryRepo: IStatusHistoryRepository,
    private noteRepo: INoteRepository,
    private goalService: GoalService
  ) {}

  createTask(dto: CreateTaskDTO, authorId: string = 'system', authorType: AuthorType = 'system'): CreateTaskResult {
    // The idempotency check, goal cap and insert must not interleave with another process.
    return this.taskRepo.runExclusive(() => this.createTaskLocked(dto, authorId, authorType));
  }

  private createTaskLocked(dto: CreateTaskDTO, authorId: string, authorType: AuthorType): CreateTaskResult {
    // 1. Check idempotency
    if (dto.idempotencyKey) {
      const existing = this.taskRepo.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        return { task: existing, isDuplicate: false, duplicateWarnings: [] };
      }
    }

    // 2. Subtask 1-level limit validation; subtasks inherit the parent's goal and workspace
    const parent = dto.parentId ? this.taskRepo.findById(dto.parentId) : null;
    if (dto.parentId) {
      if (!parent) {
        throw new TaskNotFoundError(dto.parentId);
      }
      if (parent.parentId) {
        throw new SubtaskNestingError(dto.parentId);
      }
    }

    // 3. Resolve the goal within the task's own workspace, never another project's
    let effectiveGoalId = dto.goalId || parent?.goalId;
    const workspaceForGoal = dto.workspaceId || parent?.workspaceId;
    if (!effectiveGoalId && workspaceForGoal) {
      effectiveGoalId = this.goalService.getOrCreateAdhocGoal(workspaceForGoal).id;
    }
    if (effectiveGoalId) {
      this.goalService.checkGoalCap(effectiveGoalId);
    }

    // 4. Duplicate similarity check against open work in the same workspace
    const existingTasks = this.taskRepo.list(workspaceForGoal ? { workspaceId: workspaceForGoal } : {});
    const duplicateWarnings = TaskSimilarityDetector.findPotentialDuplicates(
      dto.title,
      existingTasks.filter((t) => t.status !== 'done' && t.status !== 'dropped' && !t.isArchived)
    );

    // 5. Dependency existence and cycle validation
    if (dto.dependsOnTaskIds && dto.dependsOnTaskIds.length > 0) {
      for (const depId of dto.dependsOnTaskIds) {
        const blocker = this.taskRepo.findById(depId);
        if (!blocker) {
          throw new TaskNotFoundError(depId);
        }
      }
      const existingDeps = this.taskRepo.getAllDependencies();
      const tempId = 'candidate-task-id';
      DependencyGraph.validateNoCycles(existingDeps, tempId, dto.dependsOnTaskIds);
    }

    const now = new Date().toISOString();
    const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

    const parsedTitle = TaskTitleSanitizer.parse(dto.title, {
      type: dto.type,
      priority: dto.priority,
      tags: dto.tags,
      declaredFiles: dto.declaredFiles,
    });

    // Resolve workspaceId if omitted
    let effectiveWorkspaceId = dto.workspaceId;
    if (!effectiveWorkspaceId && effectiveGoalId) {
      try {
        const linkedGoal = this.goalService.getGoal(effectiveGoalId);
        if (linkedGoal?.workspaceId) {
          effectiveWorkspaceId = linkedGoal.workspaceId;
        }
      } catch {
        // ignore if goal not found
      }
    }
    if (!effectiveWorkspaceId && parent?.workspaceId) {
      effectiveWorkspaceId = parent.workspaceId;
    }

    const task: Task = {
      id: taskId,
      workspaceId: effectiveWorkspaceId,
      goalId: effectiveGoalId,
      parentId: dto.parentId,
      title: parsedTitle.cleanTitle,
      description: dto.description?.trim(),
      type: parsedTitle.type || 'feature',
      tags: parsedTitle.tags,
      status: 'todo',
      priority: parsedTitle.priority || 'medium',
      orderIndex: this.taskRepo.nextOrderIndex(),
      acceptanceCriteria: dto.acceptanceCriteria?.trim() || 'Criteria not specified',
      declaredFiles: parsedTitle.declaredFiles,
      verificationState: 'unverified',
      attemptCount: 0,
      closeCount: 0,
      reopenCount: 0,
      maxAttemptsAllowed: 3,
      isDeferred: Boolean(dto.isDeferred),
      claimedByAgent: dto.claimedByAgent ? dto.claimedByAgent.trim() : undefined,
      idempotencyKey: dto.idempotencyKey,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastStateChangeAt: now,
    };

    // If initial dependencies are not all done, start as blocked-on-dependency
    if (dto.dependsOnTaskIds && dto.dependsOnTaskIds.length > 0) {
      const blockers = dto.dependsOnTaskIds.map((id) => this.taskRepo.findById(id)).filter((t): t is Task => Boolean(t));
      const taskMap = new Map(blockers.map((t) => [t.id, t]));
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
    // All-or-nothing: hitting a goal cap halfway must not leave a partial batch behind.
    const results = this.taskRepo.runExclusive(() => dtos.map((dto) => this.createTask(dto, authorId, authorType)));
    // Tasks planned together are deliberately related; only flag overlap with pre-existing work.
    const batchIds = new Set(results.map((r) => r.task.id));
    for (const r of results) {
      r.duplicateWarnings = r.duplicateWarnings.filter((d) => !batchIds.has(d.existingTask.id));
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
    updates: Partial<Pick<Task, 'title' | 'description' | 'type' | 'tags' | 'priority' | 'acceptanceCriteria' | 'declaredFiles' | 'goalId' | 'isDeferred' | 'claimedByAgent'>>
  ): Task {
    return this.taskRepo.runExclusive(() => this.updateTaskLocked(taskId, updates));
  }

  private updateTaskLocked(
    taskId: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'type' | 'tags' | 'priority' | 'acceptanceCriteria' | 'declaredFiles' | 'goalId' | 'isDeferred' | 'claimedByAgent'>>
  ): Task {
    const task = this.getTask(taskId);
    const now = new Date().toISOString();

    if (updates.goalId !== undefined && updates.goalId !== task.goalId) {
      if (updates.goalId) {
        this.goalService.checkGoalCap(updates.goalId);
      }
      task.goalId = updates.goalId;
    }

    if (updates.title !== undefined) {
      const sanitized = TaskTitleSanitizer.parse(updates.title, {
        type: updates.type,
        priority: updates.priority,
        tags: updates.tags,
        declaredFiles: updates.declaredFiles,
      });
      task.title = sanitized.cleanTitle;
      if (updates.type === undefined && sanitized.type) task.type = sanitized.type;
      if (updates.priority === undefined && sanitized.priority) task.priority = sanitized.priority;
      if (updates.tags === undefined && sanitized.tags.length > 0) task.tags = sanitized.tags;
      if (updates.declaredFiles === undefined && sanitized.declaredFiles.length > 0) task.declaredFiles = sanitized.declaredFiles;
    }
    if (updates.description !== undefined) task.description = updates.description.trim();
    if (updates.type !== undefined) task.type = updates.type;
    if (updates.tags !== undefined) task.tags = updates.tags;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.acceptanceCriteria !== undefined) task.acceptanceCriteria = updates.acceptanceCriteria.trim();
    if (updates.declaredFiles !== undefined) task.declaredFiles = updates.declaredFiles;
    if (updates.isDeferred !== undefined) task.isDeferred = Boolean(updates.isDeferred);
    if (updates.claimedByAgent !== undefined) {
      task.claimedByAgent = updates.claimedByAgent ? updates.claimedByAgent.trim() : undefined;
    }

    task.updatedAt = now;
    return this.taskRepo.update(task);
  }

  /**
   * Deletes a task and its subtasks. Dependency rows cascade away with them, so tasks that were
   * waiting only on the deleted work are unblocked here instead of staying blocked forever.
   */
  deleteTask(taskId: string): boolean {
    return this.taskRepo.runExclusive(() => {
      const task = this.getTask(taskId);
      const removed = [task.id, ...this.taskRepo.listSubtasks(task.id).map((t) => t.id)];
      const waiting = new Set(removed.flatMap((id) => this.taskRepo.getDependents(id)));
      for (const id of removed) waiting.delete(id);

      const deleted = this.taskRepo.delete(task.id);
      for (const depId of waiting) {
        unblockIfReady(this.taskRepo, this.statusHistoryRepo, depId, `Auto-unblocked: Dependency ${task.id} deleted`);
      }
      return deleted;
    });
  }

  addDependency(taskId: string, dependsOnTaskId: string): void {
    if (taskId === dependsOnTaskId) {
      throw new Error('A task cannot depend on itself');
    }
    this.taskRepo.runExclusive(() => {
      const target = this.getTask(dependsOnTaskId);
      const task = this.getTask(taskId);
      DependencyGraph.validateNoCycles(this.taskRepo.getAllDependencies(), taskId, [dependsOnTaskId]);
      this.taskRepo.addDependency(taskId, dependsOnTaskId);

      // A ready task that now waits on unfinished work goes back to blocked
      if (target.status !== 'done' && target.status !== 'dropped' && task.status === 'todo') {
        this.transitionStatus(taskId, 'blocked-on-dependency', 'system', 'system', `Blocked on ${dependsOnTaskId}`);
      }
    });
  }

  removeDependency(taskId: string, dependsOnTaskId: string): void {
    this.taskRepo.runExclusive(() => {
      this.taskRepo.removeDependency(taskId, dependsOnTaskId);
      const task = this.getTask(taskId);
      if (task.status === 'blocked-on-dependency' && openBlockerIds(this.taskRepo, taskId).length === 0) {
        this.transitionStatus(taskId, 'todo', 'system', 'system', `Auto-unblocked: Dependency ${dependsOnTaskId} removed`);
      }
    });
  }

  transitionStatus(
    taskId: string,
    newStatus: TaskStatus,
    authorId: string,
    authorType: AuthorType,
    reason?: string
  ): Task {
    return this.taskRepo.runExclusive(() => this.transitionStatusLocked(taskId, newStatus, authorId, authorType, reason));
  }

  private transitionStatusLocked(
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
    } else if (newStatus === 'dropped') {
      task.droppedReason = reason?.trim();
    }
    if (newStatus === 'blocked-on-dependency' && !task.blockedReason) {
      task.blockedReason = reason;
    } else if (newStatus !== 'blocked-on-dependency') {
      task.blockedReason = undefined;
    }
    // Only an in-progress task has an owner; waiting-on-human keeps the asker's claim.
    if (newStatus !== 'doing' && newStatus !== 'waiting-on-human') {
      clearClaim(task);
    }

    const updated = this.taskRepo.update(task);
    this.recordStatusHistory(taskId, previousStatus, newStatus, authorId, authorType, reason);

    if (newStatus === 'done' || newStatus === 'dropped') {
      resolveDependents(this.taskRepo, this.statusHistoryRepo, taskId, newStatus === 'done' ? 'completed' : 'dropped');
    } else if (previousStatus === 'done') {
      reblockDependents(this.taskRepo, this.statusHistoryRepo, taskId, authorId);
    }

    return updated;
  }

  getNextUnblockedTask(
    goalId?: string,
    agentId?: string,
    avoidFileConflicts: boolean = false,
    workspaceId?: string
  ): Task | null {
    const filter: any = { status: 'todo', isDeferred: false, isArchived: false };
    if (goalId) filter.goalId = goalId;
    if (workspaceId) filter.workspaceId = workspaceId;

    const candidateTasks = this.taskRepo.list(filter);
    if (candidateTasks.length === 0) return null;

    const allTasks = this.taskRepo.list(workspaceId ? { workspaceId } : {});
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

    if (avoidFileConflicts) {
      const activeClaimedTasks = allTasks.filter(
        (t) => t.status === 'doing' && !t.isArchived && t.claimedByAgent !== agentId
      );
      const conflictFree = unblockedTasks.filter((candidate) => {
        if (!candidate.declaredFiles || candidate.declaredFiles.length === 0) return true;
        const conflicts = FileConflictDetector.detectConflicts(
          candidate.id,
          candidate.declaredFiles,
          activeClaimedTasks
        );
        return conflicts.length === 0;
      });

      if (conflictFree.length > 0) {
        return conflictFree[0];
      }
    }

    return unblockedTasks[0];
  }

  dropTask(taskId: string, reason: string, authorId: string, authorType: AuthorType = 'agent'): Task {
    if (!reason || !reason.trim()) {
      throw new MandatoryReasonMissingError('dropping task');
    }
    return this.taskRepo.runExclusive(() => {
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
    });
  }

  reopenTask(taskId: string, reason?: string, authorId: string = 'human', authorType: AuthorType = 'human'): Task {
    return this.taskRepo.runExclusive(() => {
      const task = this.getTask(taskId);
      const now = new Date().toISOString();
      const prevStatus = task.status;

      // Reopened work goes back to the queue unclaimed, and waits again if its blockers are open
      const nextStatus = returnToQueue(this.taskRepo, task);
      task.reopenCount += 1;
      task.droppedReason = undefined;
      task.completedAt = undefined;
      task.verificationState = 'unverified';
      task.rejectionReason = undefined;
      task.updatedAt = now;
      task.lastStateChangeAt = now;

      const updated = this.taskRepo.update(task);
      this.recordStatusHistory(taskId, prevStatus, nextStatus, authorId, authorType, reason || 'Task reopened');

      if (prevStatus === 'done') {
        reblockDependents(this.taskRepo, this.statusHistoryRepo, taskId, authorId);
      }

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
    });
  }

  undoStatusChange(taskId: string, authorId: string, authorType: AuthorType): Task {
    return this.taskRepo.runExclusive(() => {
      const previousEntry = this.statusHistoryRepo.findPreviousState(taskId);
      if (!previousEntry) {
        throw new Error(`No previous status history found to undo for task ${taskId}`);
      }

      const task = this.getTask(taskId);
      const currentStatus = task.status;
      const target = previousEntry.fromStatus;
      if (target === 'doing' || target === 'todo' || target === 'blocked-on-dependency') {
        // A claim cannot be restored by undo, and blockers decide between todo and blocked
        returnToQueue(this.taskRepo, task);
      } else {
        task.status = target;
        if (target !== 'waiting-on-human') clearClaim(task);
      }
      task.updatedAt = new Date().toISOString();
      task.lastStateChangeAt = task.updatedAt;

      const updated = this.taskRepo.update(task);
      this.recordStatusHistory(
        taskId,
        currentStatus,
        task.status,
        authorId,
        authorType,
        `Undid transition from ${currentStatus} back to ${task.status}`
      );

      if (currentStatus === 'done' && task.status !== 'done') {
        reblockDependents(this.taskRepo, this.statusHistoryRepo, taskId, authorId, 'undone');
      } else if (task.status === 'done' || task.status === 'dropped') {
        resolveDependents(this.taskRepo, this.statusHistoryRepo, taskId, task.status === 'done' ? 'completed' : 'dropped');
      }

      return updated;
    });
  }

  bulkDrop(taskIds: string[], reason: string, authorId: string, authorType: AuthorType = 'human'): number {
    return this.taskRepo.runExclusive(() => {
      for (const id of taskIds) this.dropTask(id, reason, authorId, authorType);
      return taskIds.length;
    });
  }

  bulkReopen(taskIds: string[], reason: string, authorId: string, authorType: AuthorType = 'human'): number {
    return this.taskRepo.runExclusive(() => {
      for (const id of taskIds) this.reopenTask(id, reason, authorId, authorType);
      return taskIds.length;
    });
  }

  logAttemptFailure(dto: LogAttemptFailureDTO): LogAttemptFailureResult {
    return this.taskRepo.runExclusive(() => {
      const task = this.getTask(dto.taskId);
      const now = new Date().toISOString();
      const prevStatus = task.status;

      task.attemptCount += 1;
      let autoEscalatedToHuman = false;

      if (task.attemptCount > task.maxAttemptsAllowed) {
        task.status = 'waiting-on-human';
        task.humanQuestion = `Task exceeded ${task.maxAttemptsAllowed} max allowed attempts (${dto.failureCategory || 'failure'}). Automated looping halted for human guidance.`;
        task.humanQuestionType = 'decision';
        task.humanAnswer = undefined;
        // Escalated work is off the agent's plate until the user answers
        clearClaim(task);
        autoEscalatedToHuman = true;
      }

      task.updatedAt = now;
      task.lastStateChangeAt = now;
      this.taskRepo.update(task);

      const noteLines = [
        `### ⚠️ Attempt Failure Log (Attempt #${task.attemptCount})`,
        dto.failureCategory ? `- **Category**: ${dto.failureCategory}` : '',
        `- **Error**:\n\`\`\`\n${dto.errorSnippet.trim()}\n\`\`\``,
        dto.hypothesis ? `- **Hypothesis**: ${dto.hypothesis.trim()}` : '',
        dto.nextAttemptPlan ? `- **Next Plan**: ${dto.nextAttemptPlan.trim()}` : '',
      ].filter(Boolean);

      const note: TaskNote = {
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        taskId: task.id,
        authorType: 'agent',
        authorId: dto.agentId,
        noteType: 'attempt_failure',
        content: noteLines.join('\n'),
        createdAt: now,
      };
      this.noteRepo.create(note);

      if (autoEscalatedToHuman) {
        this.recordStatusHistory(
          task.id,
          prevStatus,
          'waiting-on-human',
          dto.agentId,
          'agent',
          `Auto-escalated: Max attempts (${task.maxAttemptsAllowed}) exceeded after attempt #${task.attemptCount}`
        );
      }

      return {
        task,
        attemptCount: task.attemptCount,
        autoEscalatedToHuman,
        note,
      };
    });
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
    recordHistory(this.statusHistoryRepo, taskId, fromStatus, toStatus, changedBy, authorType, reason);
  }
}
