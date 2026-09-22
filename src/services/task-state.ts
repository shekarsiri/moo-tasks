import crypto from 'crypto';
import { FileConflictDetector } from '../domain/conflict.js';
import { hasLiveLease } from '../domain/lease.js';
import { AuthorType, Task, TaskStatus } from '../domain/types.js';
import { IStatusHistoryRepository, ITaskRepository } from '../infrastructure/repositories/interfaces.js';

/**
 * Shared task state rules used by every service that moves a task between statuses, so a task
 * never keeps a claim it no longer works on and dependents are re-evaluated the same way.
 */

const isSatisfied = (blocker: Task | null) => Boolean(blocker && (blocker.status === 'done' || blocker.status === 'dropped'));

/** Direct blockers of taskId that are not done or dropped. */
export function openBlockerIds(taskRepo: ITaskRepository, taskId: string): string[] {
  return taskRepo.getDependencies(taskId).filter((id) => !isSatisfied(taskRepo.findById(id)));
}

/**
 * Drops changed files that another live claim in the workspace declared and this task did not:
 * with several agents in one checkout, git alone cannot tell whose edit a file is.
 */
export function withoutOthersClaimedFiles(
  taskRepo: ITaskRepository,
  files: string[],
  task: Pick<Task, 'id' | 'workspaceId' | 'declaredFiles'>
): string[] {
  const others = taskRepo
    .list({ status: 'doing', isArchived: false, workspaceId: task.workspaceId })
    .filter((t) => t.id !== task.id && hasLiveLease(t))
    .flatMap((t) => t.declaredFiles || []);
  if (others.length === 0) return files;
  const own = task.declaredFiles || [];
  const overlaps = (file: string, list: string[]) => list.some((d) => FileConflictDetector.pathsOverlap(file, d));
  return files.filter((f) => overlaps(f, own) || !overlaps(f, others));
}

/** Drops the claim and lease. Callers use it whenever a task leaves `doing`. */
export function clearClaim(task: Task): void {
  task.claimedByAgent = undefined;
  task.claimedSessionId = undefined;
  task.claimedAt = undefined;
  task.leaseExpiresAt = undefined;
}

/** Puts a task back in the queue: `todo`, or `blocked-on-dependency` while blockers are open. */
export function returnToQueue(taskRepo: ITaskRepository, task: Task): TaskStatus {
  const open = openBlockerIds(taskRepo, task.id);
  task.status = open.length === 0 ? 'todo' : 'blocked-on-dependency';
  task.blockedReason = open.length === 0 ? undefined : `Waiting on blocker tasks: ${open.join(', ')}`;
  clearClaim(task);
  return task.status;
}

export function recordHistory(
  historyRepo: IStatusHistoryRepository,
  taskId: string,
  fromStatus: TaskStatus,
  toStatus: TaskStatus,
  changedBy: string,
  authorType: AuthorType,
  reason?: string
): void {
  historyRepo.create({
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

/** Moves a blocked task to todo once none of its blockers are open. */
export function unblockIfReady(
  taskRepo: ITaskRepository,
  historyRepo: IStatusHistoryRepository,
  taskId: string,
  reason: string
): void {
  const dep = taskRepo.findById(taskId);
  if (!dep || dep.status !== 'blocked-on-dependency' || openBlockerIds(taskRepo, taskId).length > 0) return;
  const now = new Date().toISOString();
  dep.status = 'todo';
  dep.blockedReason = undefined;
  dep.updatedAt = now;
  dep.lastStateChangeAt = now;
  taskRepo.update(dep);
  recordHistory(historyRepo, taskId, 'blocked-on-dependency', 'todo', 'system', 'system', reason);
}

/** Unblocks dependents of a task that is now done or dropped. */
export function resolveDependents(
  taskRepo: ITaskRepository,
  historyRepo: IStatusHistoryRepository,
  blockerId: string,
  why: string = 'completed'
): void {
  for (const depId of taskRepo.getDependents(blockerId)) {
    unblockIfReady(taskRepo, historyRepo, depId, `Auto-unblocked: Dependency ${blockerId} ${why}`);
  }
}

/** Re-blocks ready dependents of a task that is no longer done (reopened, rejected or undone). */
export function reblockDependents(
  taskRepo: ITaskRepository,
  historyRepo: IStatusHistoryRepository,
  blockerId: string,
  changedBy: string,
  why: string = 'reopened'
): void {
  for (const depId of taskRepo.getDependents(blockerId)) {
    const dep = taskRepo.findById(depId);
    if (!dep || dep.status !== 'todo' || openBlockerIds(taskRepo, depId).length === 0) continue;
    const now = new Date().toISOString();
    dep.status = 'blocked-on-dependency';
    dep.blockedReason = `Blocked on incomplete prerequisite: ${blockerId}`;
    dep.updatedAt = now;
    dep.lastStateChangeAt = now;
    taskRepo.update(dep);
    recordHistory(historyRepo, depId, 'todo', 'blocked-on-dependency', changedBy, 'system', `Auto-reblocked: Prerequisite ${blockerId} was ${why}`);
  }
}
