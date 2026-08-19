import { Task } from './types.js';

export interface DuplicateMatch {
  existingTask: Task;
  similarityScore: number; // 0.0 to 1.0
  reason: string;
}

export class TaskSimilarityDetector {
  private static tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  private static jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    if (setA.size === 0 || setB.size === 0) return 0.0;

    let intersectionSize = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionSize++;
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    return intersectionSize / unionSize;
  }

  /**
   * Evaluates if candidate title / description matches existing open tasks with high similarity.
   */
  static findPotentialDuplicates(
    candidateTitle: string,
    existingTasks: Task[],
    threshold: number = 0.65
  ): DuplicateMatch[] {
    const candidateTokens = this.tokenize(candidateTitle);
    const matches: DuplicateMatch[] = [];

    for (const task of existingTasks) {
      if (task.status === 'dropped' || task.isArchived) continue;

      const taskTokens = this.tokenize(task.title);
      const score = this.jaccardSimilarity(candidateTokens, taskTokens);

      if (score >= threshold || task.title.trim().toLowerCase() === candidateTitle.trim().toLowerCase()) {
        matches.push({
          existingTask: task,
          similarityScore: Math.round(score * 100) / 100,
          reason: score >= 0.95 ? 'Exact or near-exact title match' : `High word overlap (${Math.round(score * 100)}%)`,
        });
      }
    }

    return matches.sort((a, b) => b.similarityScore - a.similarityScore);
  }
}
