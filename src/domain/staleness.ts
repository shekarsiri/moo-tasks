import { Task } from './types.js';

/** Todo work untouched this long is probably no longer wanted as it was written. */
export const STALE_TODO_DAYS = 14;
/** Deferred work gets longer, since parking it was deliberate. */
export const STALE_DEFERRED_DAYS = 30;

/**
 * Why a queued task looks stale by age alone, or null. Interrupted work is never stale: someone
 * was in the middle of it. (Missing declared files are checked separately, against a checkout.)
 */
export function ageStaleReason(task: Task, now: Date = new Date()): string | null {
  if (!['todo', 'blocked-on-dependency'].includes(task.status) || task.interruptedFrom) return null;
  const age = (now.getTime() - new Date(task.updatedAt).getTime()) / 86_400_000;
  if (task.isDeferred) return age >= STALE_DEFERRED_DAYS ? `deferred and untouched for ${Math.floor(age)} days` : null;
  return age >= STALE_TODO_DAYS ? `untouched for ${Math.floor(age)} days` : null;
}
