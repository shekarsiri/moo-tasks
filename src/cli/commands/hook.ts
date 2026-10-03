import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Task, Workspace } from '../../domain/types.js';
import { DEFAULT_LEASE_SECONDS, hasLiveLease, parseAgentIdentity } from '../../domain/lease.js';
import { DatabaseManager, realpathOrResolve } from '../../infrastructure/db/database.js';
import { FileConflictDetector } from '../../domain/conflict.js';
import { DatabaseMigrator } from '../../infrastructure/db/migrations.js';
import { SqliteWorkspaceRepository } from '../../infrastructure/repositories/sqlite-workspace-repo.js';
import { SqliteTaskRepository } from '../../infrastructure/repositories/sqlite-task-repo.js';
import { createServiceContainer } from '../../services/index.js';
import { WorkspaceLocation, WorkspaceService } from '../../services/workspace-service.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import { SqliteNoteRepository } from '../../infrastructure/repositories/sqlite-note-repo.js';
import { SqliteAgentSessionRepository } from '../../infrastructure/repositories/sqlite-agent-session-repo.js';
import { GitContextService } from '../../infrastructure/git/git-context.js';
import { attributeChanges } from '../../services/task-state.js';
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

/**
 * Stop hook for a session that holds no claim: files it changed (since its session-start baseline)
 * that no task accounts for, such as edits made through the shell, which the edit gate cannot see.
 * Asks once per session for moo_log_work; files of tasks completed during the session, and files
 * other live claims hold, are not counted. Returns the reason to block with, or null.
 */
export function unclaimedChangesNudge(
  db: DatabaseType,
  taskRepo: SqliteTaskRepository,
  sessionId: string,
  workspaceId: string,
  root: string,
  now: Date = new Date()
): string | null {
  const sessions = new SqliteAgentSessionRepository(db);
  const session = sessions.find(sessionId);
  if (!session?.baseline || session.nudgedAt || session.workspaceId !== workspaceId) return null;
  const changes = GitContextService.changesSince(session.baseline, root);
  if (!changes || changes.files.length === 0) return null;

  const accounted = new Set<string>();
  for (const t of taskRepo.list({ workspaceId, isArchived: false })) {
    if (!t.completedAt || t.completedAt < session.startedAt) continue;
    for (const f of [...(t.evidence?.filesModified || []), ...taskRepo.listTouchedFiles(t.id)]) accounted.add(f);
  }
  const unaccounted = attributeChanges(taskRepo, changes.files, { id: '', workspaceId, declaredFiles: [] }).filter((f) => !accounted.has(f));
  if (unaccounted.length === 0) return null;

  sessions.markNudged(sessionId, now.toISOString());
  const files = unaccounted.slice(0, 5).join(', ') + (unaccounted.length > 5 ? `, +${unaccounted.length - 5} more` : '');
  return [
    `Moo Tasks: this session changed ${files} without a claimed task, so the change is not tracked.`,
    `Record it with moo_log_work(title, evidence) — or moo_quick_start(...) if the work continues.`,
    `If these are not changes you made (a pull, or edits by someone else), ignore this; it is asked only once per session.`,
  ].join(' ');
}

/** Tools that change files; the pre/post edit hooks are installed with this matcher. */
export const EDIT_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

export type HookEvent = 'session-start' | 'pre-edit' | 'post-edit' | 'stop';

interface HookInput {
  cwd?: string;
  /** The agent client's session id (Claude Code sends it with every hook). */
  session_id?: string;
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

/** A file's path relative to the checkout (as git reports it), or null when it is outside. */
export function repoRelativePath(root: string, filePath?: string): string | null {
  if (!filePath) return null;
  const rel = path.relative(realpathOrResolve(root), realpathOrResolve(path.resolve(root, filePath)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * The claim an edit belongs to: the only claim this session can hold, else the only one whose
 * declared files cover the path. With parallel sub-agents and no way to tell, nothing is recorded:
 * a wrong attribution would be worse than falling back to git.
 */
export function claimForEdit(candidates: Task[], file: string): Task | null {
  if (candidates.length === 1) return candidates[0];
  const covering = candidates.filter((t) => (t.declaredFiles || []).some((d) => FileConflictDetector.pathsOverlap(file, d)));
  return covering.length === 1 ? covering[0] : null;
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

/**
 * The workspace a hook runs for. Never creates one: projects that never ran `moo init` (or were
 * never opened by the MCP server) are left alone. Worktrees resolve to their main repository.
 */
export function openWorkspace(cwd: string): { db: DatabaseType; location: WorkspaceLocation; workspace: Workspace | null } {
  const db = DatabaseManager.getDatabase({ projectPath: cwd });
  DatabaseMigrator.runMigrations(db);
  const location = new WorkspaceService(new SqliteWorkspaceRepository(db)).resolveLocation(cwd, 'never');
  return { db, location, workspace: location.workspace };
}

export async function hookCommand(event: string, args: string[] = []) {
  const hooksOff = (process.env.MOO_HOOKS || '').toLowerCase();
  if (hooksOff === 'off' || hooksOff === '0' || hooksOff === 'false') return;

  // Git hooks: run by git from the repository root, with arguments instead of JSON on stdin.
  if (event === 'prepare-commit-msg' || event === 'post-commit') {
    const { db, location, workspace } = openWorkspace(process.cwd());
    if (!workspace) return;
    const root = location.checkoutRoot;
    const taskRepo = new SqliteTaskRepository(db);
    if (event === 'prepare-commit-msg') {
      if (args[0]) prepareCommitMsg(root, args[0], args[1], taskRepo, workspace.id);
    } else {
      recordCommit(root, taskRepo, workspace.id);
    }
    return;
  }

  const input = await readStdin();
  const { db, location, workspace } = openWorkspace(input.cwd || process.cwd());
  if (!workspace) return;
  // The checkout this session works in; a linked worktree maps to its main repository's workspace.
  const root = location.checkoutRoot;

  const taskRepo = new SqliteTaskRepository(db);
  const live = taskRepo.list({ status: 'doing', isArchived: false, workspaceId: workspace.id }).filter((t) => hasLiveLease(t));
  const ancestors = ancestorPids();

  if (event === 'session-start') {
    const container = createServiceContainer({ projectPath: root, register: 'never' });
    container.goalService.closeIdleGoals(workspace.id);
    // This session's own claim when it has one (a compaction or resume); otherwise show nobody's task
    // as "mine", so work a previous session left behind surfaces as interrupted instead.
    const agentId = claimsForSession(live, ancestors, os.hostname(), false)[0]?.claimedByAgent || UNKNOWN_SESSION_AGENT;
    const continuing = input.source === 'compact' || input.source === 'resume';
    if (input.session_id) {
      // Where the tree stood when this session began, so Stop can tell what the session changed.
      new SqliteAgentSessionRepository(db).start(
        {
          sessionId: input.session_id,
          workspaceId: workspace.id,
          baseline: GitContextService.captureBaseline(root),
          startedAt: new Date().toISOString(),
        },
        continuing
      );
    }
    const verbosity = continuing ? 'full' : 'standard';
    const heading = input.source === 'compact' ? '(Context was compacted: this is where you are.)\n' : '';
    process.stdout.write(heading + container.sessionService.getCompactContext(root, agentId, verbosity, workspace.id) + '\n');
    return;
  }

  if (event === 'stop') {
    if (input.stop_hook_active) return;
    const notes = new SqliteNoteRepository(db);
    const mine = claimsForSession(live, ancestors, os.hostname(), false);
    if (mine.length === 0 && input.session_id) {
      const reason = unclaimedChangesNudge(db, taskRepo, input.session_id, workspace.id, root);
      if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
      return;
    }
    for (const task of mine) {
      const lastNote = notes
        .listByTaskId(task.id)
        .filter((n) => n.authorId === task.claimedByAgent && !/^Claimed task \(Attempt|^Resumed interrupted/.test(n.content))
        .pop();
      const changes = task.claimGitBaseline ? GitContextService.changesSince(task.claimGitBaseline, root) : null;
      const own = changes ? attributeChanges(taskRepo, changes.files, task) : [];
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
    if (!isInside(WorkspaceService.checkoutPathFor(location, workspace), target)) return;
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
    // Record the edited file on the claim it belongs to, so completion credits exactly these edits.
    const file = repoRelativePath(root, input.tool_input?.file_path || input.tool_input?.notebook_path);
    const owner = file ? claimForEdit(claimsForSession(live, ancestors), file) : null;
    if (file && owner) taskRepo.recordFileTouch(owner.id, file, owner.claimedByAgent, now.toISOString());
    return;
  }

  process.stderr.write(`Unknown hook event '${event}'. Expected session-start, pre-edit, post-edit, stop, prepare-commit-msg or post-commit.\n`);
  process.exit(1);
}
