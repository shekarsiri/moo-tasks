import { execSync } from 'child_process';
import { GitContext } from '../../domain/types.js';

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

      const statusOutput = execSync('git status --porcelain', {
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
}
