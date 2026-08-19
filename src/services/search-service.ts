import { Database as DatabaseType } from "better-sqlite3";
import { Decision, Task } from "../domain/types.js";
import { ITaskRepository, IDecisionRepository } from "../infrastructure/repositories/interfaces.js";

export interface SearchResultItem {
  type: "task" | "decision";
  id: string;
  title: string;
  snippet?: string;
  priority?: string;
  status?: string;
  tags?: string[];
  task?: Task;
  decision?: Decision;
}

export interface SearchResults {
  query: string;
  total: number;
  results: SearchResultItem[];
}

export class SearchService {
  constructor(
    private db: DatabaseType,
    private taskRepo: ITaskRepository,
    private decisionRepo: IDecisionRepository
  ) {}

  search(query: string, options: { limit?: number; type?: "all" | "tasks" | "decisions" } = {}): SearchResults {
    const rawQuery = (query || "").trim();
    if (!rawQuery) {
      return { query: "", total: 0, results: [] };
    }

    const limit = options.limit || 20;
    const searchType = options.type || "all";
    const results: SearchResultItem[] = [];

    // Format query for FTS5 (support wildcard prefix matching for tokens)
    const ftsTokens = rawQuery
      .replace(/[^a-zA-Z0-9_]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t + "*");
    const ftsQuery = ftsTokens.join(" ");

    // 1. Search Tasks FTS
    if (searchType === "all" || searchType === "tasks") {
      let taskIds: string[] = [];
      try {
        if (ftsQuery) {
          const rows = this.db
            .prepare(`SELECT id FROM tasks_fts WHERE tasks_fts MATCH ? ORDER BY rank LIMIT ?`)
            .all(ftsQuery, limit) as { id: string }[];
          taskIds = rows.map((r) => r.id);
        }
      } catch {
        // Fallback to LIKE
        const fallbackTasks = this.taskRepo.list({ searchQuery: rawQuery, limit });
        taskIds = fallbackTasks.map((t) => t.id);
      }

      if (taskIds.length === 0) {
        const fallbackTasks = this.taskRepo.list({ searchQuery: rawQuery, limit });
        taskIds = fallbackTasks.map((t) => t.id);
      }

      for (const id of taskIds) {
        const task = this.taskRepo.findById(id);
        if (task && !task.isArchived) {
          results.push({
            type: "task",
            id: task.id,
            title: task.title,
            snippet: task.description ? task.description.slice(0, 140) : task.acceptanceCriteria.slice(0, 140),
            priority: task.priority,
            tags: task.tags,
            status: task.status,
            task,
          });
        }
      }
    }

    // 2. Search Decisions FTS
    if (searchType === "all" || searchType === "decisions") {
      let decisionIds: string[] = [];
      try {
        if (ftsQuery) {
          const rows = this.db
            .prepare(`SELECT id FROM decisions_fts WHERE decisions_fts MATCH ? ORDER BY rank LIMIT ?`)
            .all(ftsQuery, limit) as { id: string }[];
          decisionIds = rows.map((r) => r.id);
        }
      } catch {
        // Fallback
        const allDecisions = this.decisionRepo.list(process.cwd());
        decisionIds = allDecisions
          .filter(
            (d) =>
              d.title.toLowerCase().includes(rawQuery.toLowerCase()) ||
              d.choice.toLowerCase().includes(rawQuery.toLowerCase()) ||
              d.rationale.toLowerCase().includes(rawQuery.toLowerCase()) ||
              (d.tags && d.tags.some((t) => t.toLowerCase().includes(rawQuery.toLowerCase())))
          )
          .slice(0, limit)
          .map((d) => d.id);
      }

      for (const id of decisionIds) {
        const dec = this.decisionRepo.findById(id);
        if (dec) {
          results.push({
            type: "decision",
            id: dec.id,
            title: dec.title,
            snippet: dec.choice + " — " + dec.rationale.slice(0, 120),
            tags: dec.tags,
            status: dec.status,
            decision: dec,
          });
        }
      }
    }

    return {
      query: rawQuery,
      total: results.length,
      results: results.slice(0, limit),
    };
  }
}
