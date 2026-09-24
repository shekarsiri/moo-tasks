import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GitBaseline, GitContext } from '../../domain/types.js';

const MAX_TRACKED_DIRTY_FILES = 500;
const COMMIT_HASH = /^[0-9a-f]{7,64}$/i;

/** Runs git with an argv array: no shell, so file names and stored hashes are never interpreted. */
function git(args: string[], cwd?: string, input?: string): string {
  return execFileSync('git', args, {
    cwd,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

interface GitStatus {
  commitHash?: string;
  branch?: string;
  files: string[];
  /** Original paths of renames and copies: gone from the tree, but part of the pre-claim state. */
  renamedFrom: string[];
}

/**
 * One `git status --porcelain=v2 --branch -z` call yields HEAD, the branch and every changed or
 * untracked path. Renames and copies (type 2) carry the original path as the next NUL entry.
 */
function readStatus(cwd?: string): GitStatus {
  const entries = git(['status', '--porcelain=v2', '--branch', '-z', '-uall'], cwd).split('\0');
  const status: GitStatus = { files: [], renamedFrom: [] };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice('# branch.oid '.length);
      if (COMMIT_HASH.test(oid)) status.commitHash = oid;
    } else if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length);
      status.branch = head === '(detached)' ? 'HEAD' : head;
    } else if (entry[0] === '1') {
      status.files.push(nthField(entry, 8));
    } else if (entry[0] === '2') {
      status.files.push(nthField(entry, 9));
      if (entries[i + 1]) status.renamedFrom.push(entries[i + 1]);
      i++;
    } else if (entry[0] === 'u') {
      status.files.push(nthField(entry, 10));
    } else if (entry[0] === '?') {
      status.files.push(entry.slice(2));
    }
  }
  return status;
}

/** The rest of a space-separated record after its first n fields (paths may contain spaces). */
function nthField(entry: string, n: number): string {
  let pos = 0;
  for (let k = 0; k < n; k++) pos = entry.indexOf(' ', pos) + 1;
  return entry.slice(pos);
}

function splitZ(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

/** Content hashes in one `git hash-object --stdin-paths` call; missing files hash as 'deleted'. */
function hashFiles(files: string[], cwd?: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const base = cwd || process.cwd();
  const present: string[] = [];
  for (const file of files.slice(0, MAX_TRACKED_DIRTY_FILES)) {
    let isFile = false;
    try {
      isFile = fs.statSync(path.resolve(base, file)).isFile();
    } catch {}
    // --stdin-paths is newline-delimited, so an (unusual) name with a newline is hashed on its own.
    if (isFile && !file.includes('\n')) present.push(file);
    else hashes[file] = isFile ? hashOne(file, cwd) : 'deleted';
  }
  if (present.length === 0) return hashes;
  try {
    const out = git(['hash-object', '--stdin-paths'], cwd, present.join('\n') + '\n').trim().split('\n');
    present.forEach((file, i) => (hashes[file] = out[i] || 'deleted'));
  } catch {
    for (const file of present) hashes[file] = hashOne(file, cwd);
  }
  return hashes;
}

function hashOne(file: string, cwd?: string): string {
  try {
    return git(['hash-object', '--', file], cwd).trim();
  } catch {
    return 'deleted';
  }
}

export class GitContextService {
  /**
   * Branch, HEAD and dirty files from one git call. `details` adds the last commit subject and a
   * shortstat of uncommitted changes (two more calls), which only completion evidence needs.
   */
  static getContext(cwd: string = process.cwd(), options: { details?: boolean } = {}): GitContext {
    try {
      return GitContextService.fromStatus(readStatus(cwd), cwd, options.details !== false);
    } catch {
      // Non-fatal if git is missing or directory is not a git repo
      return {};
    }
  }

  private static fromStatus(status: GitStatus, cwd: string | undefined, details: boolean): GitContext {
    let commitSubject: string | undefined;
    let diffSummary: string | undefined;
    if (details && status.commitHash) {
      try {
        commitSubject = git(['log', '-1', '--format=%s'], cwd).trim() || undefined;
      } catch {}
      try {
        diffSummary = git(['diff', '--shortstat'], cwd).trim() || undefined;
      } catch {}
    }
    return {
      branch: status.branch || undefined,
      commitHash: status.commitHash?.slice(0, 9),
      commitSubject,
      diffSummary,
      isDirty: status.files.length > 0,
      modifiedFiles: status.files.length > 0 ? status.files : undefined,
    };
  }

  /**
   * Context plus claim baseline in two git calls: status, then one batched hash of the files that
   * are already dirty, so later changes can be attributed to the task and not to prior work.
   */
  static snapshotForClaim(cwd: string = process.cwd()): { context: GitContext; baseline?: GitBaseline } {
    let status: GitStatus;
    try {
      status = readStatus(cwd);
    } catch {
      return { context: {} };
    }
    return {
      context: GitContextService.fromStatus(status, cwd, false),
      baseline: {
        commitHash: status.commitHash,
        dirtyFileHashes: hashFiles([...status.files, ...status.renamedFrom], cwd),
        capturedAt: new Date().toISOString(),
      },
    };
  }

  /** Snapshot taken when a task is claimed: HEAD plus the content hash of every already-dirty file. */
  static captureBaseline(cwd: string = process.cwd()): GitBaseline | undefined {
    return GitContextService.snapshotForClaim(cwd).baseline;
  }

  /**
   * Files changed since the baseline (committed or not), excluding files that were already
   * dirty at claim time and have not been touched since.
   */
  static changesSince(
    baseline: GitBaseline,
    cwd: string = process.cwd()
  ): { files: string[]; diffSummary?: string } | null {
    // The hash comes from the database; only a plain hex object id is ever passed to git.
    if (!baseline.commitHash || !COMMIT_HASH.test(baseline.commitHash)) return null;
    try {
      const changed = new Set<string>();
      for (const f of splitZ(git(['diff', '--name-only', '-z', baseline.commitHash, '--'], cwd))) changed.add(f);
      for (const f of splitZ(git(['ls-files', '--others', '--exclude-standard', '-z'], cwd))) changed.add(f);

      const preDirty = Object.keys(baseline.dirtyFileHashes || {}).filter((f) => changed.has(f));
      const currentHashes = hashFiles(preDirty, cwd);
      for (const f of preDirty) {
        if (currentHashes[f] === baseline.dirtyFileHashes[f]) changed.delete(f);
      }

      let diffSummary: string | undefined;
      try {
        diffSummary =
          changed.size > 0
            ? git(['diff', '--shortstat', baseline.commitHash, '--', ...changed], cwd).trim() || undefined
            : undefined;
      } catch {}

      return { files: [...changed].sort(), diffSummary };
    } catch {
      return null;
    }
  }
}
