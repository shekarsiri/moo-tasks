import { execFileSync } from 'child_process';
import { GitBaseline, GitContext } from '../../domain/types.js';

const MAX_TRACKED_DIRTY_FILES = 500;
const COMMIT_HASH = /^[0-9a-f]{7,64}$/i;

/** Runs git with an argv array: no shell, so file names and stored hashes are never interpreted. */
function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Parses `git status --porcelain -z`: NUL-separated entries; renames and copies carry the old path next. */
function parsePorcelainZ(output: string): string[] {
  const entries = output.split('\0');
  const files: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return files;
}

function splitZ(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function hashFiles(files: string[], cwd?: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files.slice(0, MAX_TRACKED_DIRTY_FILES)) {
    try {
      hashes[file] = git(['hash-object', '--', file], cwd).trim();
    } catch {
      hashes[file] = 'deleted';
    }
  }
  return hashes;
}

export class GitContextService {
  static getContext(cwd: string = process.cwd()): GitContext {
    try {
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
      const commitHash = git(['rev-parse', '--short', 'HEAD'], cwd).trim();
      const modifiedFiles = parsePorcelainZ(git(['status', '--porcelain', '-z', '-uall'], cwd));

      let commitSubject: string | undefined;
      try {
        commitSubject = git(['log', '-1', '--format=%s'], cwd).trim() || undefined;
      } catch {}

      let diffSummary: string | undefined;
      try {
        diffSummary = git(['diff', '--stat'], cwd).trim() || undefined;
      } catch {}

      return {
        branch: branch || undefined,
        commitHash: commitHash || undefined,
        commitSubject: commitSubject || undefined,
        diffSummary: diffSummary || undefined,
        isDirty: modifiedFiles.length > 0,
        modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined,
      };
    } catch {
      // Non-fatal if git is missing or directory is not a git repo
      return {};
    }
  }

  /**
   * Snapshot taken when a task is claimed: HEAD plus the content hash of every file that
   * is already dirty, so later changes can be attributed to the task and not to prior work.
   */
  static captureBaseline(cwd: string = process.cwd()): GitBaseline | undefined {
    try {
      const commitHash = git(['rev-parse', 'HEAD'], cwd).trim();
      const dirty = parsePorcelainZ(git(['status', '--porcelain', '-z', '-uall'], cwd));
      return {
        commitHash: commitHash || undefined,
        dirtyFileHashes: hashFiles(dirty, cwd),
        capturedAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
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
