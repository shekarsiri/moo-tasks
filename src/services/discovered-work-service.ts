import crypto from 'crypto';
import { Task, TaskPriority } from '../domain/types.js';
import { TaskNotFoundError } from '../domain/errors.js';
import {
  ITaskRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';

export interface CaptureDiscoveredWorkDTO {
  currentTaskId: string;
  agentId: string;
  title: string;
  acceptanceCriteria: string;
  isMustFixNow: boolean;
  priority?: TaskPriority;
  declaredFiles?: string[];
  description?: string;
}

export class DiscoveredWorkService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private taskLifecycleService: TaskLifecycleService
  ) {}

  captureWork(dto: CaptureDiscoveredWorkDTO): { newTask: Task; currentTask: Task } {
    const currentTask = this.taskRepo.findById(dto.currentTaskId);
    if (!currentTask) {
      throw new TaskNotFoundError(dto.currentTaskId);
    }

    const priority: TaskPriority = dto.priority || (dto.isMustFixNow ? 'critical' : 'medium');
    const isDeferred = !dto.isMustFixNow;

    // Create the discovered task linked to the same goal
    const createResult = this.taskLifecycleService.createTask(
      {
        title: dto.title,
        description: dto.description,
        goalId: currentTask.goalId,
        priority,
        acceptanceCriteria: dto.acceptanceCriteria,
        declaredFiles: dto.declaredFiles,
        isDeferred,
      },
      dto.agentId,
      'agent'
    );

    const newTask = createResult.task;
    newTask.discoveredFromTaskId = dto.currentTaskId;
    this.taskRepo.update(newTask);

    // If must-fix-now, make current task depend on this new task to enforce ordering
    if (dto.isMustFixNow) {
      this.taskRepo.addDependency(currentTask.id, newTask.id);
      currentTask.status = 'blocked-on-dependency';
      currentTask.blockedReason = `Blocked on discovered must-fix work: ${newTask.id} (${newTask.title})`;
      currentTask.updatedAt = new Date().toISOString();
      currentTask.lastStateChangeAt = new Date().toISOString();
      this.taskRepo.update(currentTask);
    }

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId: currentTask.id,
      authorType: 'agent',
      authorId: dto.agentId,
      noteType: 'discovered_work',
      content: `Discovered new work: ${newTask.id} ("${newTask.title}"). Type: ${dto.isMustFixNow ? 'MUST-FIX-NOW (Blocker)' : 'DEFERRED'}`,
      createdAt: new Date().toISOString(),
    });

    return {
      newTask,
      currentTask,
    };
  }
}
