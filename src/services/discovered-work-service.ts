import crypto from 'crypto';
import { Task, TaskPriority, TaskType } from '../domain/types.js';
import { TaskNotFoundError } from '../domain/errors.js';
import {
  ITaskRepository,
  INoteRepository,
} from '../infrastructure/repositories/interfaces.js';
import { clearClaim } from './task-state.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';

export interface CaptureDiscoveredWorkDTO {
  currentTaskId: string;
  agentId: string;
  title: string;
  acceptanceCriteria?: string;
  isMustFixNow?: boolean;
  /** Already fixed as part of the current task: recorded as done work, linked to it. */
  alreadyFixed?: boolean;
  /** What was wrong and how it was fixed (alreadyFixed only). */
  fixNote?: string;
  type?: TaskType;
  tags?: string[];
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
    return this.taskRepo.runExclusive(() => this.captureWorkLocked(dto));
  }

  private captureWorkLocked(dto: CaptureDiscoveredWorkDTO): { newTask: Task; currentTask: Task } {
    const currentTask = this.taskRepo.findById(dto.currentTaskId);
    if (!currentTask) {
      throw new TaskNotFoundError(dto.currentTaskId);
    }

    const alreadyFixed = Boolean(dto.alreadyFixed);
    const mustFixNow = Boolean(dto.isMustFixNow) && !alreadyFixed;
    const priority: TaskPriority = dto.priority || (mustFixNow ? 'critical' : 'medium');
    const isDeferred = !mustFixNow && !alreadyFixed;

    // Create the discovered task linked to the same goal
    const createResult = this.taskLifecycleService.createTask(
      {
        title: dto.title,
        description: dto.description,
        type: dto.type || (mustFixNow || alreadyFixed ? 'bug' : 'feature'),
        tags: dto.tags || [],
        goalId: currentTask.goalId,
        priority,
        acceptanceCriteria: dto.acceptanceCriteria || dto.title,
        declaredFiles: dto.declaredFiles,
        isDeferred,
      },
      dto.agentId,
      'agent'
    );

    const newTask = createResult.task;
    newTask.discoveredFromTaskId = dto.currentTaskId;
    if (alreadyFixed) {
      // The fix ships with the current task's changes; it is recorded, not queued.
      const now = new Date().toISOString();
      newTask.status = 'done';
      newTask.verificationState = 'agent_completed';
      newTask.closeCount += 1;
      newTask.completedAt = now;
      newTask.lastStateChangeAt = now;
      newTask.evidence = {
        filesModified: dto.declaredFiles?.length ? dto.declaredFiles : undefined,
        notes: dto.fixNote?.trim() || undefined,
        outputSnippet: `Fixed while working on ${currentTask.id} ("${currentTask.title}")`,
      };
    }
    this.taskRepo.update(newTask);

    // If must-fix-now, make current task depend on this new task to enforce ordering
    if (mustFixNow) {
      this.taskRepo.addDependency(currentTask.id, newTask.id);
      currentTask.status = 'blocked-on-dependency';
      // The blocked task waits unclaimed so the agent is free to pick up the must-fix work
      clearClaim(currentTask);
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
      content: `Discovered new work: ${newTask.id} ("${newTask.title}"). Type: ${
        alreadyFixed ? `ALREADY FIXED in this task${dto.fixNote ? ` — ${dto.fixNote.trim()}` : ''}` : mustFixNow ? 'MUST-FIX-NOW (Blocker)' : 'DEFERRED'
      }`,
      createdAt: new Date().toISOString(),
    });

    return {
      newTask,
      currentTask,
    };
  }
}
