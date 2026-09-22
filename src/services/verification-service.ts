import crypto from 'crypto';
import { AuthorType, Task, TaskEvidence } from '../domain/types.js';
import {
  InvalidTaskStateError,
  MandatoryReasonMissingError,
  NotTaskHolderError,
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
import { ClaimService, ClaimTaskOptions, ClaimTaskResult, RepoRootResolver } from './claim-service.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';
import { reblockDependents, resolveDependents, returnToQueue, withoutOthersClaimedFiles } from './task-state.js';

export interface CompleteAndClaimNextResult {
  completedTask: Task;
  nextTask: Task | null;
  claimResult: ClaimTaskResult | null;
  hint: string;
}

export class VerificationService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository,
    private taskLifecycleService?: TaskLifecycleService,
    private claimService?: ClaimService,
    private resolveRepoRoot: RepoRootResolver = () => undefined
  ) {}

  completeTask(
    taskId: string,
    agentId: string,
    evidence: TaskEvidence,
    notes?: string
  ): Task {
    const preview = this.taskRepo.findById(taskId);
    if (!preview) {
      throw new TaskNotFoundError(taskId);
    }

    // Git is read outside the write lock; caller-supplied gitContext is never trusted as proof.
    const gitCwd = this.resolveRepoRoot(preview);
    const gitContext = GitContextService.getContext(gitCwd);
    const changes = preview.claimGitBaseline ? GitContextService.changesSince(preview.claimGitBaseline, gitCwd) : null;

    const updated = this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }

      // 1. Only the current holder of an in-progress task can complete it
      if (task.status !== 'doing') {
        throw new InvalidTaskStateError(taskId, 'complete', task.status, ['doing']);
      }
      if (task.claimedByAgent !== agentId) {
        throw new NotTaskHolderError(taskId, 'complete', agentId, task.claimedByAgent);
      }

      // 2. Evidence: real output, or code changes git can attribute to this claim
      const finalEvidence: TaskEvidence = { ...evidence, gitContext };
      const ownChanges = changes ? withoutOthersClaimedFiles(this.taskRepo, changes.files, task) : [];
      if (ownChanges.length > 0) {
        if (!finalEvidence.filesModified || finalEvidence.filesModified.length === 0) {
          finalEvidence.filesModified = ownChanges;
        }
        // The shortstat covers every changed file, so it is only kept when all of them are ours
        if (ownChanges.length === changes!.files.length) {
          gitContext.diffSummary = changes!.diffSummary || gitContext.diffSummary;
        }
        gitContext.modifiedFiles = ownChanges;
      }
      const hasOutputProof =
        Boolean(evidence.testProof && evidence.testProof.trim()) ||
        Boolean(evidence.outputSnippet && evidence.outputSnippet.trim());
      const hasGitProof = ownChanges.length > 0;
      if (!hasOutputProof && !hasGitProof) {
        throw new MissingEvidenceError(taskId);
      }

      // 3. Cannot close parent if subtasks are open
      const openSubtasks = this.taskRepo
        .listSubtasks(taskId)
        .filter((s) => ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(s.status));
      if (openSubtasks.length > 0) {
        throw new ParentHasOpenSubtasksError(taskId, openSubtasks.length);
      }

      const now = new Date().toISOString();
      task.status = 'done';
      task.verificationState = 'agent_completed';
      task.evidence = finalEvidence;
      task.closeCount += 1;
      task.completedAt = now;
      task.updatedAt = now;
      task.lastStateChangeAt = now;
      task.claimedByAgent = undefined;
      task.claimedSessionId = undefined;
      task.leaseExpiresAt = undefined;
      const saved = this.taskRepo.update(task);

      let gitInfo = '';
      if (gitContext.commitHash) {
        gitInfo = `\nGit: ${gitContext.commitHash}${gitContext.commitSubject ? ` - "${gitContext.commitSubject}"` : ''}${gitContext.branch ? ` on [${gitContext.branch}]` : ''}${gitContext.isDirty ? ' [dirty]' : ''}`;
      }
      if (ownChanges.length > 0) {
        gitInfo += `\nChanges since claim: ${ownChanges.length === changes!.files.length && changes!.diffSummary ? changes!.diffSummary : ownChanges.join(', ')}`;
      }

      this.noteRepo.create({
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        authorType: 'agent',
        authorId: agentId,
        noteType: 'verification_note',
        content: `Completed by agent ${agentId}.\nCommands: ${evidence.commandsRun?.join(', ') || 'N/A'}\nProof: ${evidence.testProof || evidence.outputSnippet || 'git changes since claim'}${gitInfo}\n${notes ? `Notes: ${notes}` : ''}`.trim(),
        gitContext,
        createdAt: now,
      });

      this.statusHistoryRepo.create({
        id: `hist-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        fromStatus: 'doing',
        toStatus: 'done',
        changedBy: agentId,
        authorType: 'agent',
        reason: `Agent completed with proof`,
        timestamp: now,
      });

      resolveDependents(this.taskRepo, this.statusHistoryRepo, taskId);
      return saved;
    });

    return updated;
  }

  completeAndClaimNext(
    taskId: string,
    agentId: string,
    sessionId: string,
    evidence: TaskEvidence,
    options: {
      nextClaimOptions?: ClaimTaskOptions;
      notes?: string;
    } = {}
  ): CompleteAndClaimNextResult {
    const completedTask = this.completeTask(taskId, agentId, evidence, options.notes);

    if (!this.taskLifecycleService || !this.claimService) {
      return {
        completedTask,
        nextTask: null,
        claimResult: null,
        hint: `Completed task ${taskId}. ClaimService or TaskLifecycleService not configured for auto-claim.`,
      };
    }

    const nextTask = this.taskLifecycleService.getNextUnblockedTask(completedTask.goalId, agentId, false, completedTask.workspaceId);
    if (!nextTask) {
      return {
        completedTask,
        nextTask: null,
        claimResult: null,
        hint: `Completed task ${taskId}. No further unblocked tasks ready in goal.`,
      };
    }

    const claimResult = this.claimService.claimTask(
      nextTask.id,
      agentId,
      sessionId,
      options.nextClaimOptions
    );

    return {
      completedTask,
      nextTask: claimResult.task,
      claimResult,
      hint: `Completed task ${taskId} and atomically claimed next task ${nextTask.id}: "${nextTask.title}"`,
    };
  }

  verifyTask(
    taskId: string,
    verifierId: string,
    verifierType: AuthorType = 'human',
    notes?: string
  ): Task {
    return this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      // Only finished work can be signed off
      if (task.status !== 'done') {
        throw new InvalidTaskStateError(taskId, 'verify', task.status, ['done']);
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
    });
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

    return this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      if (task.status !== 'done') {
        throw new InvalidTaskStateError(taskId, 'reject', task.status, ['done']);
      }

      const now = new Date().toISOString();
      const prevStatus = task.status;

      // Rejected work returns to the queue unclaimed, blocked again if its own blockers reopened
      const nextStatus = returnToQueue(this.taskRepo, task);
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
        toStatus: nextStatus,
        changedBy: rejecterId,
        authorType: rejecterType,
        reason: `Rejected: ${reason.trim()}`,
        timestamp: now,
      });

      reblockDependents(this.taskRepo, this.statusHistoryRepo, taskId, rejecterId, 'rejected');

      return updated;
    });
  }
}
