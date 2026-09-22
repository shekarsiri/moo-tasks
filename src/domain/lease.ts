import os from 'os';
import { Task } from './types.js';

/**
 * Default agent identity for MCP sessions: `<client>@<host>:<pid>`, where pid is
 * the agent host process (e.g. the Claude Code CLI) that spawned the MCP server.
 */
export function formatAgentIdentity(clientName: string, pid: number, host: string = os.hostname()): string {
  const client = (clientName || 'mcp-client').trim().replace(/\s+/g, '-').toLowerCase();
  return `${client}@${host}:${pid}`;
}

export function parseAgentIdentity(agentId: string): { host: string; pid: number } | null {
  const match = /@([^@:]+):(\d+)$/.exec(agentId || '');
  if (!match) return null;
  return { host: match[1], pid: parseInt(match[2], 10) };
}

/**
 * True only when the holder is a process identity on this machine that no longer
 * exists. Anything we cannot prove dead (other hosts, custom agent ids) is alive.
 */
export function isHolderProcessDead(agentId?: string): boolean {
  if (!agentId) return false;
  const parsed = parseAgentIdentity(agentId);
  if (!parsed || parsed.host !== os.hostname()) return false;
  try {
    process.kill(parsed.pid, 0);
    return false;
  } catch (err: any) {
    return err?.code === 'ESRCH';
  }
}

/** A lease is live when someone holds it, it has not expired, and its holder process still exists. */
export function hasLiveLease(task: Task, now: Date = new Date()): boolean {
  if (!task.claimedByAgent) return false;
  if (task.leaseExpiresAt && new Date(task.leaseExpiresAt) <= now) return false;
  return !isHolderProcessDead(task.claimedByAgent);
}

export const DEFAULT_LEASE_SECONDS = 30 * 60;
