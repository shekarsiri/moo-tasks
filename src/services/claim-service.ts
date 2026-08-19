import crypto from 'crypto';
import { Decision, Task, TaskNote } from '../domain/types.js';
import {
  AgentConcurrencyLimitError,
  TaskAlreadyClaimedError,
  TaskBlockedOnDependencyError,
  TaskNotFoundError,
  TaskWaitingOnHumanError,
} from '../domain/errors.js';
import { ConflictWarning, FileConflictDetector } from '../domain/conflict.js';
import { DependencyGraph } from '../domain/dependency.js';
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

export class ClaimService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository,
    private decisionRepo?: IDecisionRepository
  ) {}

  claimTask(
    taskId: string,
    agentId: string,
    sessionId: string,
    options: ClaimTaskOptions = {}
  ): ClaimTaskResult {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    // 0. Guardrail: Verify task is not blocked on human without an answer
    if (task.status === 'waiting-on-human' && !task.humanAnswer) {
      throw new TaskWaitingOnHumanError(taskId, task.humanQuestion);
    }

    // 0b. Guardrail: Verify task is not blocked on dependencies
    const allTasks = this.taskRepo.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const allDeps = this.taskRepo.getAllDependencies();
    const isUnblocked = DependencyGraph.isTaskUnblocked(taskId, allDeps, taskMap);

    if (!isUnblocked || task.status === 'blocked-on-dependency') {
      if (!isUnblocked) {
        throw new TaskBlockedOnDependencyError(taskId, task.blockedReason);
      }
    }

    const now = new Date();
    const leaseSeconds = options.leaseDurationSeconds || 300; // default 5 minutes
    const maxConcurrent = options.maxConcurrentTasksPerAgent || 1;

    // 1. Check if task is already held by someone else with an active lease
    if (task.claimedByAgent && task.claimedByAgent !== agentId) {
      if (task.leaseExpiresAt && new Date(task.leaseExpiresAt) > now) {
        throw new TaskAlreadyClaimedError(taskId, task.claimedByAgent, task.leaseExpiresAt);
      }
    }

    // 2. Check agent concurrency limit (only count active tasks with unexpired leases)
    const activeAgentTasks = this.taskRepo.list({
      status: 'doing',
      claimedByAgent: agentId,
      isArchived: false,
    }).filter((t) => t.id !== taskId && (!t.leaseExpiresAt || new Date(t.leaseExpiresAt) > now));

    if (activeAgentTasks.length >= maxConcurrent) {
      throw new AgentConcurrencyLimitError(agentId, maxConcurrent);
    }

    // 3. Increment attempt counter
    task.attemptCount += 1;
    let autoEscalatedToHuman = false;

    // 4. Stall / Loop Detection: If attempt count exceeds maxAttemptsAllowed, escalate to human
    if (task.attemptCount > task.maxAttemptsAllowed) {
      task.status = 'waiting-on-human';
      task.humanQuestion = `Task has reached ${task.attemptCount} failed attempts. Automated looping halted for human guidance.`;
      task.humanQuestionType = 'decision';
      autoEscalatedToHuman = true;
    } else {
      task.status = 'doing';
    }

    // 5. Set ownership & lease
    const leaseExpires = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    task.claimedByAgent = agentId;
    task.claimedSessionId = sessionId;
    task.claimedAt = now.toISOString();
    task.leaseExpiresAt = leaseExpires;
    task.lastStateChangeAt = now.toISOString();
    task.updatedAt = now.toISOString();

    if (options.declaredFiles && options.declaredFiles.length > 0) {
      task.declaredFiles = options.declaredFiles;
    }

    // 6. File touch conflict check
    const activeTasks = this.taskRepo.list({ status: 'doing', isArchived: false });
    const conflictWarnings = FileConflictDetector.detectConflicts(
      task.id,
      task.declaredFiles,
      activeTasks
    );

    // 7. Auto capture git context and save note
    const gitContext = GitContextService.getContext();
    this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: 'agent',
      authorId: agentId,
      noteType: 'general',
      content: `Claimed task (Attempt #${task.attemptCount}, Lease: ${leaseSeconds}s). Session: ${sessionId}`,
      gitContext,
      createdAt: now.toISOString(),
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus: task.status === 'doing' ? 'todo' : 'doing',
      toStatus: task.status,
      changedBy: agentId,
      authorType: 'agent',
      reason: `Claimed by agent ${agentId}`,
      timestamp: now.toISOString(),
    });

    // 8. Auto-match relevant accepted ADR decisions
    let relatedDecisions: Decision[] = [];
    if (this.decisionRepo) {
      const allAccepted = this.decisionRepo.list('', 'accepted');
      if (allAccepted.length > 0) {
        const textToMatch = [
          task.title,
          task.type,
          ...(task.tags || []),
          ...(task.declaredFiles || []),
          task.description || '',
        ].join(' ').toLowerCase();

        const words = textToMatch
          .replace(/[^a-z0-9_\-\/]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into'].includes(w));

        const wordSet = new Set(words);
        const taskTagSet = new Set((task.tags || []).map((t) => t.toLowerCase()));

        relatedDecisions = allAccepted.filter((dec) => {
          // Check tags intersection
          if (dec.tags && dec.tags.some((tag) => taskTagSet.has(tag.toLowerCase()) || wordSet.has(tag.toLowerCase()) || textToMatch.includes(tag.toLowerCase()))) {
            return true;
          }
          // Check title / choice tokens
          const decWords = (dec.title + ' ' + dec.choice)
            .toLowerCase()
            .replace(/[^a-z0-9_\-\/]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into'].includes(w));

          return decWords.some((w) => wordSet.has(w));
        }).slice(0, 5);
      }
    }

    // 9. Fetch previous failure logs and hypotheses if task was retried
    let previousFailureHistory: TaskNote[] = [];
    if (task.attemptCount > 1) {
      const allNotes = this.noteRepo.listByTaskId(taskId);
      previousFailureHistory = allNotes.filter(
        (n) => n.noteType === 'attempt_failure' || n.noteType === 'attempt_log' || n.noteType === 'rejection_reason'
      );
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

  heartbeatTask(taskId: string, agentId: string, extensionSeconds: number = 300): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    if (task.claimedByAgent !== agentId) {
      throw new Error(`Cannot heartbeat task ${taskId} held by agent '${task.claimedByAgent}'`);
    }

    const now = new Date();
    task.leaseExpiresAt = new Date(now.getTime() + extensionSeconds * 1000).toISOString();
    task.updatedAt = now.toISOString();

    return this.taskRepo.update(task);
  }

  releaseTask(taskId: string, agentId: string, notes?: string): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    if (task.claimedByAgent && task.claimedByAgent !== agentId) {
      throw new Error(`Cannot release task ${taskId} claimed by agent '${task.claimedByAgent}'`);
    }

    const now = new Date().toISOString();
    const prevStatus = task.status;

    // Check if task dependencies are currently satisfied
    const allTasks = this.taskRepo.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const allDeps = this.taskRepo.getAllDependencies();
    const isUnblocked = DependencyGraph.isTaskUnblocked(taskId, allDeps, taskMap);

    const nextStatus = isUnblocked ? 'todo' : 'blocked-on-dependency';
    task.status = nextStatus;
    if (!isUnblocked) {
      const blockers = allDeps.filter((d) => d.taskId === taskId).map((d) => d.dependsOnTaskId);
      task.blockedReason = `Waiting on blocker tasks: ${blockers.join(', ')}`;
    } else {
      task.blockedReason = undefined;
    }

    task.claimedByAgent = undefined;
    task.claimedSessionId = undefined;
    task.claimedAt = undefined;
    task.leaseExpiresAt = undefined;
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
      fromStatus: prevStatus,
      toStatus: nextStatus,
      changedBy: agentId,
      authorType: 'agent',
      reason: `Released voluntarily by agent ${agentId}`,
      timestamp: now,
    });

    return updated;
  }

  handoffTask(
    taskId: string,
    fromAgentId: string,
    toAgentId: string,
    handoffSummary: string,
    sessionId: string
  ): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const now = new Date();
    task.claimedByAgent = toAgentId;
    task.claimedSessionId = sessionId;
    task.claimedAt = now.toISOString();
    task.leaseExpiresAt = new Date(now.getTime() + 300 * 1000).toISOString();
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
  }

  cleanupExpiredLeases(): number {
    const now = new Date();
    const activeTasks = this.taskRepo.list({ status: 'doing', isArchived: false });
    let releasedCount = 0;

    const allTasks = this.taskRepo.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const allDeps = this.taskRepo.getAllDependencies();

    for (const task of activeTasks) {
      if (task.leaseExpiresAt && new Date(task.leaseExpiresAt) < now) {
        const expiredAgent = task.claimedByAgent;
        const isUnblocked = DependencyGraph.isTaskUnblocked(task.id, allDeps, taskMap);
        const nextStatus = isUnblocked ? 'todo' : 'blocked-on-dependency';

        task.status = nextStatus;
        if (!isUnblocked) {
          const blockers = allDeps.filter((d) => d.taskId === task.id).map((d) => d.dependsOnTaskId);
          task.blockedReason = `Waiting on blocker tasks: ${blockers.join(', ')}`;
        } else {
          task.blockedReason = undefined;
        }

        task.claimedByAgent = undefined;
        task.claimedSessionId = undefined;
        task.leaseExpiresAt = undefined;
        task.updatedAt = now.toISOString();
        task.lastStateChangeAt = now.toISOString();
        this.taskRepo.update(task);

        this.noteRepo.create({
          id: `note-${crypto.randomUUID().slice(0, 8)}`,
          taskId: task.id,
          authorType: 'system',
          authorId: 'lease-monitor',
          noteType: 'general',
          content: `Lease expired for silent agent '${expiredAgent}'. Task returned to queue (${nextStatus}).`,
          createdAt: now.toISOString(),
        });

        this.statusHistoryRepo.create({
          id: `hist-${crypto.randomUUID().slice(0, 8)}`,
          taskId: task.id,
          fromStatus: 'doing',
          toStatus: nextStatus,
          changedBy: 'lease-monitor',
          authorType: 'system',
          reason: `Auto-released: agent ${expiredAgent} lease expired`,
          timestamp: now.toISOString(),
        });

        releasedCount++;
      }
    }

    return releasedCount;
  }
}
