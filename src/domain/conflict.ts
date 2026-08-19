import { Task } from './types.js';

export interface ConflictWarning {
  conflictingTaskId: string;
  conflictingTaskTitle: string;
  claimedByAgent?: string;
  overlappingFiles: string[];
}

export class FileConflictDetector {
  /**
   * Normalizes a file path for comparison (handles leading slashes, relative paths).
   */
  static normalizePath(p: string): string {
    return p.trim().replace(/^\.\//, '').toLowerCase();
  }

  /**
   * Checks whether two file paths or directory prefixes overlap.
   */
  static pathsOverlap(pathA: string, pathB: string): boolean {
    const a = this.normalizePath(pathA);
    const b = this.normalizePath(pathB);

    if (a === b) return true;
    if (a.endsWith('/') && b.startsWith(a)) return true;
    if (b.endsWith('/') && a.startsWith(b)) return true;
    if (b.startsWith(a + '/')) return true;
    if (a.startsWith(b + '/')) return true;

    return false;
  }

  /**
   * Detects if declaring a list of files for a task conflicts with other active claimed tasks.
   */
  static detectConflicts(
    targetTaskId: string,
    declaredFiles: string[],
    activeClaimedTasks: Task[]
  ): ConflictWarning[] {
    if (!declaredFiles || declaredFiles.length === 0) return [];

    const warnings: ConflictWarning[] = [];

    for (const otherTask of activeClaimedTasks) {
      if (otherTask.id === targetTaskId) continue;
      if (!otherTask.declaredFiles || otherTask.declaredFiles.length === 0) continue;

      const overlapping: string[] = [];
      for (const targetFile of declaredFiles) {
        for (const otherFile of otherTask.declaredFiles) {
          if (this.pathsOverlap(targetFile, otherFile)) {
            overlapping.push(`${targetFile} ~ ${otherFile}`);
          }
        }
      }

      if (overlapping.length > 0) {
        warnings.push({
          conflictingTaskId: otherTask.id,
          conflictingTaskTitle: otherTask.title,
          claimedByAgent: otherTask.claimedByAgent,
          overlappingFiles: Array.from(new Set(overlapping)),
        });
      }
    }

    return warnings;
  }
}
