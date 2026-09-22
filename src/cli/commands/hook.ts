import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Task } from '../../domain/types.js';
import { DEFAULT_LEASE_SECONDS, hasLiveLease, parseAgentIdentity } from '../../domain/lease.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';
import { DatabaseMigrator } from '../../infrastructure/db/migrations.js';
import { SqliteWorkspaceRepository } from '../../infrastructure/repositories/sqlite-workspace-repo.js';
import { SqliteTaskRepository } from '../../infrastructure/repositories/sqlite-task-repo.js';
import { createServiceContainer } from '../../services/index.js';

/** Tools that change files; the pre/post edit hooks are installed with this matcher. */
export const EDIT_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

export type HookEvent = 'session-start' | 'pre-edit' | 'post-edit';

interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

/** Process ids above this hook process: one of them is the agent host (e.g. Claude Code). */
export function ancestorPids(start: number = process.ppid, maxDepth = 12): Set<number> {
  const pids = new Set<number>();
  let pid = start;
  for (let i = 0; i < maxDepth && pid > 1; i++) {
    pids.add(pid);
    try {
      pid = parseInt(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf-8' }).trim(), 10);
    } catch {
      break;
    }
  }
  return pids;
}

/**
 * Claims this agent session can be said to hold: identities whose pid is one of our ancestors.
 * With includeUnattributed, custom agentIds (sub-agents) that no process can be matched to count
 * too; that is enough to allow an edit, but never to renew a lease another agent may own.
 */
export function claimsForSession(
  liveTasks: Task[],
  ancestors: Set<number>,
  host: string = os.hostname(),
  includeUnattributed: boolean = true
): Task[] {
  return liveTasks.filter((t) => {
    const parsed = parseAgentIdentity(t.claimedByAgent || '');
    if (!parsed) return includeUnattributed;
    return parsed.host === host && ancestors.has(parsed.pid);
  });
}

export function isInside(root: string, filePath?: string): boolean {
  if (!filePath) return true;
  const rel = path.relative(root, path.resolve(root, filePath));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export const NO_CLAIM_MESSAGE = [
  'Moo Tasks: no claimed task for this session in this workspace.',
  'Before editing, call moo_quick_start(title, acceptanceCriteria, declaredFiles) — or moo_get_next_task(claim: true) for planned work.',
  'For a change that is already done, use moo_log_work(title, evidence).',
].join('\n');

async function readStdin(): Promise<HookInput> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
  } catch {
    return {};
  }
}

export async function hookCommand(event: string) {
  const hooksOff = (process.env.MOO_HOOKS || '').toLowerCase();
  if (hooksOff === 'off' || hooksOff === '0' || hooksOff === 'false') return;

  const input = await readStdin();
  const root = DatabaseManager.findProjectRoot(input.cwd || process.cwd());

  // Never create a workspace from a hook: projects that never ran `moo init` are left alone.
  const db = DatabaseManager.getDatabase({ projectPath: root });
  DatabaseMigrator.runMigrations(db);
  const workspace = new SqliteWorkspaceRepository(db).findByPath(root);
  if (!workspace) return;

  if (event === 'session-start') {
    const container = createServiceContainer({ projectPath: root });
    process.stdout.write(
      container.sessionService.getCompactContext(root, undefined, 'standard', workspace.id) + '\n'
    );
    return;
  }

  const taskRepo = new SqliteTaskRepository(db);
  const live = taskRepo.list({ status: 'doing', isArchived: false, workspaceId: workspace.id }).filter((t) => hasLiveLease(t));
  const ancestors = ancestorPids();

  if (event === 'pre-edit') {
    const mine = claimsForSession(live, ancestors);
    const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
    if (!isInside(workspace.rootPath, target)) return;
    if (mine.length === 0) {
      process.stderr.write(NO_CLAIM_MESSAGE + '\n');
      process.exit(2);
    }
    return;
  }

  if (event === 'post-edit') {
    const now = new Date();
    const expires = new Date(now.getTime() + DEFAULT_LEASE_SECONDS * 1000).toISOString();
    for (const task of claimsForSession(live, ancestors, os.hostname(), false)) {
      taskRepo.renewLeaseIfHolder(task.id, task.claimedByAgent!, expires, now.toISOString());
    }
    return;
  }

  process.stderr.write(`Unknown hook event '${event}'. Expected session-start, pre-edit or post-edit.\n`);
  process.exit(1);
}
