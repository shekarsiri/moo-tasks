import crypto from 'crypto';
import { AuthorType, Task, TaskEvidence } from '../domain/types.js';
import {
  MandatoryReasonMissingError,
  MissingEvidenceError,
  ParentHasOpenSubtasksError,
  TaskNotFoundError,
} from '../domain/errors.js';
import { GitContextService } from '../infrastructure/git/git-context.js';
import {
  ITaskRepository,
  INoteRepository,
  IStatusHistoryRepository,
} from '../infrastructure/repositories/interfaces.js';
import { DependencyGraph } from '../domain/dependency.js';

export class VerificationService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository
  ) {}

  completeTask(
    taskId: string,
    agentId: string,
    evidence: TaskEvidence,
    notes?: string
  ): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    // 1. Evidence is mandatory to close
    const hasEvidence =
      (evidence.commandsRun && evidence.commandsRun.length > 0) ||
      (evidence.outputSnippet && evidence.outputSnippet.trim().length > 0) ||
      (evidence.testProof && evidence.testProof.trim().length > 0) ||
      (evidence.filesModified && evidence.filesModified.length > 0);

    if (!hasEvidence) {
      throw new MissingEvidenceError(taskId);
    }

    // 2. Cannot close parent if subtasks are open
    const subtasks = this.taskRepo.listSubtasks(taskId);
    const openSubtasks = subtasks.filter((s) =>
      ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(s.status)
    );
    if (openSubtasks.length > 0) {
      throw new ParentHasOpenSubtasksError(taskId, openSubtasks.length);
    }

    const now = new Date().toISOString();
    const prevStatus = task.status;
    const gitContext = GitContextService.getContext();

    // Set completion fields
    task.status = 'done';
    task.verificationState = 'agent_completed';
    task.evidence = evidence;
    task.closeCount += 1;
    task.completedAt = now;
    task.updatedAt = now;
    task.lastStateChangeAt = now;
    task.claimedByAgent = undefined;
    task.claimedSessionId = undefined;
    task.leaseExpiresAt = undefined;

    const updated = this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: 'agent',
      authorId: agentId,
      noteType: 'verification_note',
      content: `Completed by agent ${agentId}.\nCommands: ${evidence.commandsRun?.join(', ') || 'N/A'}\nProof: ${evidence.testProof || evidence.outputSnippet || 'Provided'}\n${notes ? `Notes: ${notes}` : ''}`,
      gitContext,
      createdAt: now,
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus: prevStatus,
      toStatus: 'done',
      changedBy: agentId,
      authorType: 'agent',
      reason: `Agent completed with proof`,
      timestamp: now,
    });

    // Auto resolve downstream dependencies
    this.resolveDependents(taskId);

    return updated;
  }

  verifyTask(
    taskId: string,
    verifierId: string,
    verifierType: AuthorType = 'human',
    notes?: string
  ): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const now = new Date().toISOString();
    task.verificationState = 'verified_done';
    task.verifiedBy = verifierId;
    task.verifiedAt = now;
    task.updatedAt = now;

    const updated = this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: verifierType,
      authorId: verifierId,
      noteType: 'verification_note',
      content: `Task verified as DONE by ${verifierType} '${verifierId}'. ${notes ? `Notes: ${notes}` : ''}`,
      createdAt: now,
    });

    return updated;
  }

  rejectTask(
    taskId: string,
    rejecterId: string,
    rejecterType: AuthorType,
    reason: string
  ): Task {
    if (!reason || !reason.trim()) {
      throw new MandatoryReasonMissingError('rejecting completed task');
    }

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const now = new Date().toISOString();
    const prevStatus = task.status;

    task.status = 'todo';
    task.verificationState = 'rejected';
    task.rejectionReason = reason.trim();
    task.reopenCount += 1;
    task.completedAt = undefined;
    task.updatedAt = now;
    task.lastStateChangeAt = now;

    const updated = this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: rejecterType,
      authorId: rejecterId,
      noteType: 'rejection_reason',
      content: `Rejected by ${rejecterType} '${rejecterId}': ${reason.trim()}`,
      createdAt: now,
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus: prevStatus,
      toStatus: 'todo',
      changedBy: rejecterId,
      authorType: rejecterType,
      reason: `Rejected: ${reason.trim()}`,
      timestamp: now,
    });

    return updated;
  }

  private resolveDependents(finishedTaskId: string): void {
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
          this.statusHistoryRepo.create({
            id: `hist-${crypto.randomUUID().slice(0, 8)}`,
            taskId: depId,
            fromStatus: 'blocked-on-dependency',
            toStatus: 'todo',
            changedBy: 'system',
            authorType: 'system',
            reason: `Auto-unblocked: Dependency ${finishedTaskId} completed`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }
}
