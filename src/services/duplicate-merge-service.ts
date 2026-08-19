import crypto from 'crypto';
import { Task } from '../domain/types.js';
import { MandatoryReasonMissingError, TaskNotFoundError } from '../domain/errors.js';
import {
  ITaskRepository,
  INoteRepository,
  IStatusHistoryRepository,
} from '../infrastructure/repositories/interfaces.js';

export class DuplicateMergeService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository
  ) {}

  mergeTasks(
    targetTaskId: string,
    sourceTaskId: string,
    authorId: string,
    reason?: string
  ): { targetTask: Task; mergedSourceTask: Task } {
    if (targetTaskId === sourceTaskId) {
      throw new Error('Cannot merge a task into itself');
    }

    const targetTask = this.taskRepo.findById(targetTaskId);
    if (!targetTask) throw new TaskNotFoundError(targetTaskId);

    const sourceTask = this.taskRepo.findById(sourceTaskId);
    if (!sourceTask) throw new TaskNotFoundError(sourceTaskId);

    const now = new Date().toISOString();

    // 1. Move subtasks from source to target (or target's parent if target is already a subtask)
    const effectiveParentId = targetTask.parentId || targetTaskId;
    const subtasks = this.taskRepo.listSubtasks(sourceTaskId);
    for (const subtask of subtasks) {
      subtask.parentId = effectiveParentId;
      subtask.updatedAt = now;
      this.taskRepo.update(subtask);
    }

    // 2. Transfer dependencies from source to target
    const sourceDeps = this.taskRepo.getDependencies(sourceTaskId);
    for (const depId of sourceDeps) {
      if (depId !== targetTaskId) {
        this.taskRepo.addDependency(targetTaskId, depId);
      }
    }

    const sourceDependents = this.taskRepo.getDependents(sourceTaskId);
    for (const dependentId of sourceDependents) {
      if (dependentId !== targetTaskId) {
        this.taskRepo.addDependency(dependentId, targetTaskId);
      }
    }

    // 3. Mark source task as dropped/merged
    const prevStatus = sourceTask.status;
    sourceTask.status = 'dropped';
    sourceTask.droppedReason = `Merged into task ${targetTaskId}: ${reason || 'Duplicate task'}`;
    sourceTask.updatedAt = now;
    sourceTask.lastStateChangeAt = now;
    this.taskRepo.update(sourceTask);

    // 4. Create audit notes
    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId: targetTaskId,
      authorType: 'agent',
      authorId,
      noteType: 'general',
      content: `Merged task ${sourceTaskId} ("${sourceTask.title}") into this task. Reason: ${reason || 'Duplicate'}`,
      createdAt: now,
    });

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId: sourceTaskId,
      authorType: 'agent',
      authorId,
      noteType: 'drop_reason',
      content: `Task merged into ${targetTaskId}. Reason: ${reason || 'Duplicate'}`,
      createdAt: now,
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId: sourceTaskId,
      fromStatus: prevStatus,
      toStatus: 'dropped',
      changedBy: authorId,
      authorType: 'agent',
      reason: `Merged into ${targetTaskId}`,
      timestamp: now,
    });

    return {
      targetTask,
      mergedSourceTask: sourceTask,
    };
  }
}
