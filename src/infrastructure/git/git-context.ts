import { execSync } from 'child_process';
import { GitBaseline, GitContext } from '../../domain/types.js';

const MAX_TRACKED_DIRTY_FILES = 500;

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parsePorcelain(output: string): string[] {
  return output
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '';
      let filename = line.slice(3).trim();
      if (filename.includes(' -> ')) filename = filename.split(' -> ')[1].trim();
      return filename.replace(/^"|"$/g, '');
    })
    .filter(Boolean);
}

function hashFiles(files: string[], cwd: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  if (files.length === 0) return hashes;
  const existing = files.slice(0, MAX_TRACKED_DIRTY_FILES);
  for (const file of existing) {
    try {
      hashes[file] = git(`hash-object -- ${JSON.stringify(file)}`, cwd).trim();
    } catch {
      hashes[file] = 'deleted';
    }
  }
  return hashes;
}


export class GitContextService {
  static getContext(cwd: string = process.cwd()): GitContext {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
      }).trim();

      const commitHash = execSync('git rev-parse --short HEAD', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
      }).trim();

      const statusOutput = execSync('git status --porcelain -uall', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
      });

      const modifiedFiles = statusOutput
        ? statusOutput
            .split('\n')
            .map((line) => {
              if (!line.trim()) return '';
              const trimmed = line.trimStart();
              const match = trimmed.match(/^([A-Z?]{1,2})\s+(.*)$/);
              let filename = match ? match[2].trim() : line.slice(3).trim();
              if (filename.includes(' -> ')) {
                filename = filename.split(' -> ')[1].trim();
              }
              return filename;
            })
            .filter(Boolean)
        : [];
      let commitSubject: string | undefined;
      try {
        commitSubject = execSync('git log -1 --format=%s', {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf-8',
        }).trim() || undefined;
      } catch {}

      let diffSummary: string | undefined;
      try {
        diffSummary = execSync('git diff --stat', {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf-8',
        }).trim() || undefined;
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
      const commitHash = git('rev-parse HEAD', cwd).trim();
      const dirty = parsePorcelain(git('status --porcelain -uall', cwd));
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
    if (!baseline.commitHash) return null;
    try {
      const changed = new Set<string>();
      for (const f of git(`diff --name-only ${baseline.commitHash}`, cwd).split('\n')) {
        if (f.trim()) changed.add(f.trim());
      }
      for (const f of git('ls-files --others --exclude-standard', cwd).split('\n')) {
        if (f.trim()) changed.add(f.trim());
      }

      const preDirty = Object.keys(baseline.dirtyFileHashes || {}).filter((f) => changed.has(f));
      const currentHashes = hashFiles(preDirty, cwd);
      for (const f of preDirty) {
        if (currentHashes[f] === baseline.dirtyFileHashes[f]) changed.delete(f);
      }

      let diffSummary: string | undefined;
      try {
        const tracked = [...changed].map((f) => JSON.stringify(f)).join(' ');
        diffSummary = tracked
          ? git(`diff --shortstat ${baseline.commitHash} -- ${tracked}`, cwd).trim() || undefined
          : undefined;
      } catch {}

      return { files: [...changed].sort(), diffSummary };
    } catch {
      return null;
    }
  }
}
