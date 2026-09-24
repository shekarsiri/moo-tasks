import fs from 'fs';
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
import { SqliteNoteRepository } from '../../infrastructure/repositories/sqlite-note-repo.js';
import { GitContextService } from '../../infrastructure/git/git-context.js';
import { withoutOthersClaimedFiles } from '../../services/task-state.js';
import { prepareCommitMsg, recordCommit } from './git-hooks.js';

/** Minutes a claimed task may accumulate changes without a note before the Stop hook asks for one. */
export const CHECKPOINT_MINUTES = Number(process.env.MOO_CHECKPOINT_MINUTES) || 15;

/** Matches no real agent: lets resume show interrupted work without guessing whose task is "mine". */
const UNKNOWN_SESSION_AGENT = 'session-start-hook';

/**
 * Stop hook policy: ask for a checkpoint once when this session's task has changes git can see and
 * nothing was written down for CHECKPOINT_MINUTES. Returns the reason to block with, or null.
 */
export function checkpointNudge(
  task: Task,
  lastNoteAt: string | undefined,
  changedFiles: string[],
  now: Date = new Date(),
  minutes: number = CHECKPOINT_MINUTES
): string | null {
  if (changedFiles.length === 0) return null;
  const last = [lastNoteAt, task.claimedAt].filter(Boolean).map((t) => new Date(t!).getTime());
  const since = last.length ? Math.max(...last) : 0;
  if (now.getTime() - since < minutes * 60_000) return null;
  const files = changedFiles.slice(0, 5).join(', ') + (changedFiles.length > 5 ? `, +${changedFiles.length - 5} more` : '');
  return [
    `Moo Tasks: task ${task.id} ("${task.title}") has uncommitted progress (${files}) and no note in ${minutes}+ minutes.`,
    `Before stopping, call moo_checkpoint(taskId: '${task.id}', note: what is done, what is next, open questions) —`,
    `or moo_complete_task if it is finished — so the next session can pick up from here.`,
  ].join(' ');
}

/** Tools that change files; the pre/post edit hooks are installed with this matcher. */
export const EDIT_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

export type HookEvent = 'session-start' | 'pre-edit' | 'post-edit' | 'stop';

interface HookInput {
  cwd?: string;
  /** SessionStart: startup | resume | clear | compact */
  source?: string;
  /** Stop: true when Claude is already continuing because of a Stop hook */
  stop_hook_active?: boolean;
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

const realpath = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Workspace for a repo root; git reports real paths, which differ from registered ones behind symlinks (/var vs /private/var). */
export function findWorkspaceForRoot(db: ReturnType<typeof DatabaseManager.getDatabase>, root: string) {
  const repo = new SqliteWorkspaceRepository(db);
  const direct = repo.findByPath(root);
  if (direct) return direct;
  const real = realpath(root);
  return repo.list().find((w) => realpath(w.rootPath) === real) || null;
}

export async function hookCommand(event: string, args: string[] = []) {
  const hooksOff = (process.env.MOO_HOOKS || '').toLowerCase();
  if (hooksOff === 'off' || hooksOff === '0' || hooksOff === 'false') return;

  // Git hooks: run by git from the repository root, with arguments instead of JSON on stdin.
  if (event === 'prepare-commit-msg' || event === 'post-commit') {
    const root = DatabaseManager.findProjectRoot(process.cwd());
    const db = DatabaseManager.getDatabase({ projectPath: root });
    DatabaseMigrator.runMigrations(db);
    const workspace = findWorkspaceForRoot(db, root);
    if (!workspace) return;
    const taskRepo = new SqliteTaskRepository(db);
    if (event === 'prepare-commit-msg') {
      if (args[0]) prepareCommitMsg(root, args[0], args[1], taskRepo, workspace.id);
    } else {
      recordCommit(root, taskRepo, workspace.id);
    }
    return;
  }

  const input = await readStdin();
  const root = DatabaseManager.findProjectRoot(input.cwd || process.cwd());

  // Never create a workspace from a hook: projects that never ran `moo init` are left alone.
  const db = DatabaseManager.getDatabase({ projectPath: root });
  DatabaseMigrator.runMigrations(db);
  const workspace = findWorkspaceForRoot(db, root);
  if (!workspace) return;

  const taskRepo = new SqliteTaskRepository(db);
  const live = taskRepo.list({ status: 'doing', isArchived: false, workspaceId: workspace.id }).filter((t) => hasLiveLease(t));
  const ancestors = ancestorPids();

  if (event === 'session-start') {
    const container = createServiceContainer({ projectPath: root });
    // This session's own claim when it has one (a compaction or resume); otherwise show nobody's task
    // as "mine", so work a previous session left behind surfaces as interrupted instead.
    const agentId = claimsForSession(live, ancestors, os.hostname(), false)[0]?.claimedByAgent || UNKNOWN_SESSION_AGENT;
    const verbosity = input.source === 'compact' || input.source === 'resume' ? 'full' : 'standard';
    const heading = input.source === 'compact' ? '(Context was compacted: this is where you are.)\n' : '';
    process.stdout.write(heading + container.sessionService.getCompactContext(root, agentId, verbosity, workspace.id) + '\n');
    return;
  }

  if (event === 'stop') {
    if (input.stop_hook_active) return;
    const notes = new SqliteNoteRepository(db);
    for (const task of claimsForSession(live, ancestors, os.hostname(), false)) {
      const lastNote = notes
        .listByTaskId(task.id)
        .filter((n) => n.authorId === task.claimedByAgent && !/^Claimed task \(Attempt|^Resumed interrupted/.test(n.content))
        .pop();
      const changes = task.claimGitBaseline ? GitContextService.changesSince(task.claimGitBaseline, workspace.rootPath) : null;
      const own = changes ? withoutOthersClaimedFiles(taskRepo, changes.files, task) : [];
      const reason = checkpointNudge(task, lastNote?.createdAt, own);
      if (reason) {
        process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
        return;
      }
    }
    return;
  }

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

  process.stderr.write(`Unknown hook event '${event}'. Expected session-start, pre-edit, post-edit, stop, prepare-commit-msg or post-commit.\n`);
  process.exit(1);
}
