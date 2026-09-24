import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Task } from '../../domain/types.js';
import { ITaskRepository } from '../../infrastructure/repositories/interfaces.js';

/** Marks hook scripts Moo wrote, so reinstalling updates them and foreign hooks are never replaced. */
export const GIT_HOOK_MARKER = '# moo-tasks-hook';
export const TRAILER_KEY = 'Moo-Task';
const GIT_HOOKS = ['prepare-commit-msg', 'post-commit'] as const;
/** Completed tasks older than this are not offered as the subject of a new commit. */
const RECENT_DONE_DAYS = 14;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const matches = (file: string, candidate: string) => file === candidate || file.endsWith('/' + candidate) || candidate.endsWith('/' + file);

/**
 * Tasks a commit of these staged files most likely carries: work in progress whose declared files
 * are staged, and recently completed work (not yet committed) whose changed files are staged.
 */
export function tasksForStagedFiles(tasks: Task[], staged: string[], now: Date = new Date()): Task[] {
  const cutoff = now.getTime() - RECENT_DONE_DAYS * 86_400_000;
  return tasks.filter((t) => {
    if (t.isArchived) return false;
    let files: string[];
    if (t.status === 'doing') {
      files = t.declaredFiles || [];
    } else if (t.status === 'done' && !(t.commits && t.commits.length) && t.completedAt && new Date(t.completedAt).getTime() >= cutoff) {
      files = t.evidence?.filesModified?.length ? t.evidence.filesModified : t.declaredFiles || [];
    } else {
      return false;
    }
    return files.some((f) => staged.some((s) => matches(s, f)));
  });
}

/** prepare-commit-msg: adds a `Moo-Task: <id>` trailer per matching task (git dedupes and keeps comments in place). */
export function prepareCommitMsg(root: string, msgFile: string, source: string | undefined, taskRepo: ITaskRepository, workspaceId: string): string[] {
  if (source === 'merge' || source === 'squash') return [];
  const staged = git(['diff', '--cached', '--name-only', '-z'], root).split('\0').filter(Boolean);
  if (staged.length === 0) return [];
  const candidates = taskRepo.list({ workspaceId, isArchived: false }).filter((t) => t.status === 'doing' || t.status === 'done');
  const ids = tasksForStagedFiles(candidates, staged).map((t) => t.id);
  if (ids.length === 0) return [];
  const file = path.resolve(root, msgFile);
  git(
    ['interpret-trailers', '--in-place', '--if-exists', 'addIfDifferent', ...ids.flatMap((id) => ['--trailer', `${TRAILER_KEY}: ${id}`]), file],
    root
  );
  return ids;
}

/** post-commit: records HEAD on every task its `Moo-Task:` trailers name. */
export function recordCommit(root: string, taskRepo: ITaskRepository, workspaceId: string): { commit: string; taskIds: string[] } {
  const [hash, trailers = ''] = git(['log', '-1', `--format=%H%x00%(trailers:key=${TRAILER_KEY},valueonly)`], root).split('\0');
  const taskIds: string[] = [];
  for (const id of trailers.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const task = taskRepo.findById(id, workspaceId);
    if (!task || (task.workspaceId && task.workspaceId !== workspaceId)) continue;
    taskRepo.addCommit(task.id, hash.trim());
    taskIds.push(task.id);
  }
  return { commit: hash.trim(), taskIds };
}

export interface GitHookInstallResult {
  hook: string;
  path: string;
  result: 'installed' | 'updated' | 'skipped-foreign';
}

/** Installs the git hooks into the repository's hooks directory (honours core.hooksPath). */
export function installGitHooks(root: string, commandPrefix: string): GitHookInstallResult[] {
  const hooksDir = path.resolve(root, git(['rev-parse', '--git-path', 'hooks'], root).trim());
  fs.mkdirSync(hooksDir, { recursive: true });
  return GIT_HOOKS.map((hook) => {
    const file = path.join(hooksDir, hook);
    const exists = fs.existsSync(file);
    if (exists && !fs.readFileSync(file, 'utf-8').includes(GIT_HOOK_MARKER)) {
      return { hook, path: file, result: 'skipped-foreign' as const };
    }
    // A Moo failure must never block a commit.
    const script = `#!/bin/sh\n${GIT_HOOK_MARKER}\n${commandPrefix} ${hook} "$@" >/dev/null 2>&1 || true\n`;
    fs.writeFileSync(file, script, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    return { hook, path: file, result: exists ? ('updated' as const) : ('installed' as const) };
  });
}
