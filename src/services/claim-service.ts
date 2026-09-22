import crypto from 'crypto';
import { Decision, Task, TaskNote, TaskStatus } from '../domain/types.js';
import {
  AgentConcurrencyLimitError,
  InvalidTaskStateError,
  NotTaskHolderError,
  TaskAlreadyClaimedError,
  TaskBlockedOnDependencyError,
  TaskNotClaimableError,
  TaskNotFoundError,
  TaskWaitingOnHumanError,
} from '../domain/errors.js';
import { ConflictWarning, FileConflictDetector } from '../domain/conflict.js';
import { DependencyGraph } from '../domain/dependency.js';
import { DEFAULT_LEASE_SECONDS, hasLiveLease, isHolderProcessDead } from '../domain/lease.js';
import { GitContextService } from '../infrastructure/git/git-context.js';
import {
  ITaskRepository,
  INoteRepository,
  IStatusHistoryRepository,
  IDecisionRepository,
} from '../infrastructure/repositories/interfaces.js';

export interface ClaimTaskOptions {
  leaseDurationSeconds?: number;
  declaredFiles?: string[];
  maxConcurrentTasksPerAgent?: number;
}

export interface ClaimTaskResult {
  task: Task;
  conflictWarnings: ConflictWarning[];
  attemptCount: number;
  autoEscalatedToHuman: boolean;
  relatedDecisions?: Decision[];
  previousFailureHistory?: TaskNote[];
}

/** Resolves the repository root a task's git evidence should be read from. */
export type RepoRootResolver = (task: Task) => string | undefined;

const STOP_WORDS = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into'];

export class ClaimService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository,
    private decisionRepo?: IDecisionRepository,
    private resolveRepoRoot: RepoRootResolver = () => undefined
  ) {}

  claimTask(
    taskId: string,
    agentId: string,
    sessionId: string,
    options: ClaimTaskOptions = {}
  ): ClaimTaskResult {
    const preview = this.taskRepo.findById(taskId);
    if (!preview) {
      throw new TaskNotFoundError(taskId);
    }
    // Git runs outside the write lock: it is slow and only describes the working tree.
    const gitCwd = this.resolveRepoRoot(preview);
    const gitContext = GitContextService.getContext(gitCwd);
    const gitBaseline = GitContextService.captureBaseline(gitCwd);

    const leaseSeconds = options.leaseDurationSeconds || DEFAULT_LEASE_SECONDS;
    const maxConcurrent = options.maxConcurrentTasksPerAgent || 1;

    const { task, autoEscalatedToHuman, conflictWarnings } = this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      const now = new Date();
      const fromStatus: TaskStatus = task.status;
      const heldByOther = Boolean(task.claimedByAgent && task.claimedByAgent !== agentId);

      // 1. Status guardrails
      if (task.status === 'waiting-on-human' && !task.humanAnswer) {
        throw new TaskWaitingOnHumanError(taskId, task.humanQuestion);
      }
      if (task.status === 'done' || task.status === 'dropped') {
        throw new TaskNotClaimableError(taskId, task.status);
      }

      // 2. Dependency guardrail (dropped blockers count as satisfied)
      const blockerIds = this.taskRepo.getDependencies(taskId);
      if (blockerIds.length > 0) {
        const blockers = blockerIds.map((id) => this.taskRepo.findById(id)).filter((t): t is Task => Boolean(t));
        const taskMap = new Map(blockers.map((t) => [t.id, t]));
        const deps = blockerIds.map((id) => ({ taskId, dependsOnTaskId: id, createdAt: '' }));
        if (!DependencyGraph.isTaskUnblocked(taskId, deps, taskMap)) {
          throw new TaskBlockedOnDependencyError(taskId, task.blockedReason);
        }
      }

      // 3. Exclusive ownership: someone else's live lease wins
      if (heldByOther && hasLiveLease(task, now)) {
        throw new TaskAlreadyClaimedError(taskId, task.claimedByAgent!, task.leaseExpiresAt);
      }

      // 4. Agent concurrency limit (only live leases count)
      const activeAgentTasks = this.taskRepo
        .list({ status: 'doing', claimedByAgent: agentId, isArchived: false })
        .filter((t) => t.id !== taskId && hasLiveLease(t, now));
      if (activeAgentTasks.length >= maxConcurrent) {
        throw new AgentConcurrencyLimitError(agentId, maxConcurrent);
      }

      // 5. Attempts count fresh claims only; renewing your own claim is not a new attempt
      const isRenewal = task.status === 'doing' && task.claimedByAgent === agentId;
      let autoEscalatedToHuman = false;
      if (!isRenewal) {
        task.attemptCount += 1;
      }
      if (task.attemptCount > task.maxAttemptsAllowed) {
        task.status = 'waiting-on-human';
        task.humanQuestion = `Task has reached ${task.attemptCount} attempts. Automated looping halted for human guidance.`;
        task.humanQuestionType = 'decision';
        task.humanAnswer = undefined;
        task.claimedByAgent = undefined;
        task.claimedSessionId = undefined;
        task.leaseExpiresAt = undefined;
        autoEscalatedToHuman = true;
      } else {
        task.status = 'doing';
        task.claimedByAgent = agentId;
        task.claimedSessionId = sessionId;
        task.claimedAt = now.toISOString();
        task.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
        if (!isRenewal || !task.claimGitBaseline) {
          task.claimGitBaseline = gitBaseline;
        }
      }
      task.lastStateChangeAt = now.toISOString();
      task.updatedAt = now.toISOString();

      if (options.declaredFiles && options.declaredFiles.length > 0) {
        task.declaredFiles = options.declaredFiles;
      }

      // 6. File touch conflict check against other live claims in the same workspace
      const activeTasks = this.taskRepo
        .list({ status: 'doing', isArchived: false, workspaceId: task.workspaceId })
        .filter((t) => hasLiveLease(t, now));
      const conflictWarnings = FileConflictDetector.detectConflicts(task.id, task.declaredFiles, activeTasks);

      this.taskRepo.update(task);

      this.noteRepo.create({
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        authorType: 'agent',
        authorId: agentId,
        noteType: 'general',
        content: autoEscalatedToHuman
          ? `Claim refused: attempt #${task.attemptCount} exceeds ${task.maxAttemptsAllowed}; escalated to human.`
          : `Claimed task (Attempt #${task.attemptCount}, Lease: ${leaseSeconds}s). Session: ${sessionId}`,
        gitContext,
        createdAt: now.toISOString(),
      });

      if (fromStatus !== task.status) {
        this.statusHistoryRepo.create({
          id: `hist-${crypto.randomUUID().slice(0, 8)}`,
          taskId,
          fromStatus,
          toStatus: task.status,
          changedBy: agentId,
          authorType: 'agent',
          reason: autoEscalatedToHuman ? 'Auto-escalated: max attempts exceeded' : `Claimed by agent ${agentId}`,
          timestamp: now.toISOString(),
        });
      }

      return { task, autoEscalatedToHuman, conflictWarnings };
    });

    // 7. Related accepted ADR decisions from the task's own workspace
    const relatedDecisions = this.findRelatedDecisions(task);

    // 8. Previous failure logs when the task is being retried
    let previousFailureHistory: TaskNote[] = [];
    if (task.attemptCount > 1) {
      previousFailureHistory = this.noteRepo
        .listByTaskId(taskId)
        .filter((n) => n.noteType === 'attempt_failure' || n.noteType === 'attempt_log' || n.noteType === 'rejection_reason');
    }

    return {
      task,
      conflictWarnings,
      attemptCount: task.attemptCount,
      autoEscalatedToHuman,
      relatedDecisions,
      previousFailureHistory: previousFailureHistory.length > 0 ? previousFailureHistory : undefined,
    };
  }

  private findRelatedDecisions(task: Task): Decision[] {
    if (!this.decisionRepo || !task.workspaceId) return [];
    const accepted = this.decisionRepo.list(undefined, 'accepted', undefined, task.workspaceId);
    if (accepted.length === 0) return [];

    const tokenize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9_\-\/]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

    const textToMatch = [task.title, task.type, ...(task.tags || []), ...(task.declaredFiles || []), task.description || '']
      .join(' ')
      .toLowerCase();
    const wordSet = new Set(tokenize(textToMatch));
    const taskTagSet = new Set((task.tags || []).map((t) => t.toLowerCase()));

    return accepted
      .filter((dec) => {
        if (dec.tags?.some((tag) => taskTagSet.has(tag.toLowerCase()) || wordSet.has(tag.toLowerCase()))) {
          return true;
        }
        return tokenize(dec.title + ' ' + dec.choice).some((w) => wordSet.has(w));
      })
      .slice(0, 5);
  }

  heartbeatTask(taskId: string, agentId: string, extensionSeconds: number = DEFAULT_LEASE_SECONDS): Task {
    return this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      if (task.status !== 'doing') {
        throw new InvalidTaskStateError(taskId, 'heartbeat', task.status, ['doing']);
      }
      if (task.claimedByAgent !== agentId) {
        throw new NotTaskHolderError(taskId, 'heartbeat', agentId, task.claimedByAgent);
      }

      const now = new Date();
      task.leaseExpiresAt = new Date(now.getTime() + extensionSeconds * 1000).toISOString();
      task.updatedAt = now.toISOString();
      this.taskRepo.updateLease(taskId, task.leaseExpiresAt, task.updatedAt);
      return task;
    });
  }

  /** Extend the lease if agentId currently holds taskId; silently ignore otherwise. */
  renewIfHolder(taskId: string, agentId: string, extensionSeconds: number = DEFAULT_LEASE_SECONDS): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task || task.status !== 'doing' || task.claimedByAgent !== agentId) return false;
    const now = new Date();
    this.taskRepo.updateLease(taskId, new Date(now.getTime() + extensionSeconds * 1000).toISOString(), now.toISOString());
    return true;
  }

  releaseTask(taskId: string, agentId: string, notes?: string): Task {
    return this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      if (task.status !== 'doing') {
        throw new InvalidTaskStateError(taskId, 'release', task.status, ['doing']);
      }
      if (task.claimedByAgent !== agentId && hasLiveLease(task)) {
        throw new NotTaskHolderError(taskId, 'release', agentId, task.claimedByAgent);
      }

      const now = new Date().toISOString();
      const nextStatus = this.returnToQueue(task);
      task.updatedAt = now;
      task.lastStateChangeAt = now;
      const updated = this.taskRepo.update(task);

      if (notes) {
        this.noteRepo.create({
          id: `note-${crypto.randomUUID().slice(0, 8)}`,
          taskId,
          authorType: 'agent',
          authorId: agentId,
          noteType: 'general',
          content: `Voluntary release notes: ${notes.trim()}`,
          createdAt: now,
        });
      }

      this.statusHistoryRepo.create({
        id: `hist-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        fromStatus: 'doing',
        toStatus: nextStatus,
        changedBy: agentId,
        authorType: 'agent',
        reason: `Released voluntarily by agent ${agentId}`,
        timestamp: now,
      });

      return updated;
    });
  }

  handoffTask(
    taskId: string,
    fromAgentId: string,
    toAgentId: string,
    handoffSummary: string,
    sessionId: string
  ): Task {
    return this.taskRepo.runExclusive(() => {
      const task = this.taskRepo.findById(taskId);
      if (!task) {
        throw new TaskNotFoundError(taskId);
      }
      if (task.status !== 'doing') {
        throw new InvalidTaskStateError(taskId, 'hand off', task.status, ['doing']);
      }
      if (task.claimedByAgent !== fromAgentId) {
        throw new NotTaskHolderError(taskId, 'hand off', fromAgentId, task.claimedByAgent);
      }

      const now = new Date();
      task.claimedByAgent = toAgentId;
      task.claimedSessionId = sessionId;
      task.claimedAt = now.toISOString();
      task.leaseExpiresAt = new Date(now.getTime() + DEFAULT_LEASE_SECONDS * 1000).toISOString();
      task.updatedAt = now.toISOString();

      const updated = this.taskRepo.update(task);

      this.noteRepo.create({
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        authorType: 'agent',
        authorId: fromAgentId,
        noteType: 'handoff_note',
        content: `Handoff from '${fromAgentId}' to '${toAgentId}': ${handoffSummary.trim()}`,
        createdAt: now.toISOString(),
      });

      return updated;
    });
  }

  /**
   * Returns expired or dead-holder claims to the queue. Each task is re-checked inside its
   * own exclusive transaction so a heartbeat that lands concurrently is never overwritten.
   */
  cleanupExpiredLeases(workspaceId?: string): number {
    const candidates = this.taskRepo
      .list({ status: 'doing', isArchived: false, workspaceId })
      .filter((t) => !hasLiveLease(t));
    let releasedCount = 0;

    for (const candidate of candidates) {
      const released = this.taskRepo.runExclusive(() => {
        const task = this.taskRepo.findById(candidate.id);
        if (!task || task.status !== 'doing' || hasLiveLease(task)) return false;

        const expiredAgent = task.claimedByAgent;
        const reason = isHolderProcessDead(expiredAgent) ? 'holder process exited' : 'lease expired';
        const now = new Date().toISOString();
        const nextStatus = this.returnToQueue(task);
        task.updatedAt = now;
        task.lastStateChangeAt = now;
        this.taskRepo.update(task);

        this.noteRepo.create({
          id: `note-${crypto.randomUUID().slice(0, 8)}`,
          taskId: task.id,
          authorType: 'system',
          authorId: 'lease-monitor',
          noteType: 'general',
          content: `Claim by '${expiredAgent}' released (${reason}). Task returned to queue (${nextStatus}).`,
          createdAt: now,
        });

        this.statusHistoryRepo.create({
          id: `hist-${crypto.randomUUID().slice(0, 8)}`,
          taskId: task.id,
          fromStatus: 'doing',
          toStatus: nextStatus,
          changedBy: 'lease-monitor',
          authorType: 'system',
          reason: `Auto-released: agent ${expiredAgent} ${reason}`,
          timestamp: now,
        });
        return true;
      });
      if (released) releasedCount++;
    }

    return releasedCount;
  }

  /** Clears ownership and sets todo or blocked-on-dependency. Caller persists the task. */
  private returnToQueue(task: Task): TaskStatus {
    const blockerIds = this.taskRepo.getDependencies(task.id);
    const blockers = blockerIds.map((id) => this.taskRepo.findById(id)).filter((t): t is Task => Boolean(t));
    const deps = blockerIds.map((id) => ({ taskId: task.id, dependsOnTaskId: id, createdAt: '' }));
    const isUnblocked = DependencyGraph.isTaskUnblocked(task.id, deps, new Map(blockers.map((t) => [t.id, t])));

    task.status = isUnblocked ? 'todo' : 'blocked-on-dependency';
    task.blockedReason = isUnblocked ? undefined : `Waiting on blocker tasks: ${blockerIds.join(', ')}`;
    task.claimedByAgent = undefined;
    task.claimedSessionId = undefined;
    task.claimedAt = undefined;
    task.leaseExpiresAt = undefined;
    return task.status;
  }
}
