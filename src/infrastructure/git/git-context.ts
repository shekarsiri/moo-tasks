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
      }).trim();

      const modifiedFiles = statusOutput
        ? statusOutput
            .split('\n')
            .map((line) => line.trim().slice(3))
            .filter(Boolean)
        : [];

      return {
        branch: branch || undefined,
        commitHash: commitHash || undefined,
        isDirty: modifiedFiles.length > 0,
        modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined,
      };
    } catch {
      // Non-fatal if git is missing or directory is not a git repo
      return {};
    }
  }
}
