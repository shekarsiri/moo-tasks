import { Database as DatabaseType } from 'better-sqlite3';
import { Goal, GoalStatus } from '../../domain/types.js';
import { IGoalRepository } from './interfaces.js';

export class SqliteGoalRepository implements IGoalRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): Goal {
    return {
      id: row.id,
      title: row.title,
      verbatimPrompt: row.verbatim_prompt,
      status: row.status as GoalStatus,
      maxOpenTasksCap: row.max_open_tasks_cap,
      projectPath: row.project_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      droppedReason: row.dropped_reason || undefined,
    };
  }

  create(goal: Goal): Goal {
    const stmt = this.db.prepare(`
      INSERT INTO goals (
        id, title, verbatim_prompt, status, max_open_tasks_cap, project_path,
        created_at, updated_at, completed_at, dropped_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      goal.id,
      goal.title,
      goal.verbatimPrompt,
      goal.status,
      goal.maxOpenTasksCap,
      goal.projectPath,
      goal.createdAt,
      goal.updatedAt,
      goal.completedAt || null,
      goal.droppedReason || null
    );

    return goal;
  }

  findById(id: string): Goal | null {
    const stmt = this.db.prepare(`SELECT * FROM goals WHERE id = ?`);
    const row = stmt.get(id);
    return row ? this.mapRow(row) : null;
  }

  list(projectPath: string, status?: GoalStatus): Goal[] {
    let query = `SELECT * FROM goals WHERE project_path = ?`;
    const params: any[] = [projectPath];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;
    const rows = this.db.prepare(query).all(...params);
    return rows.map((r) => this.mapRow(r));
  }

  update(goal: Goal): Goal {
    const stmt = this.db.prepare(`
      UPDATE goals SET
        title = ?,
        verbatim_prompt = ?,
        status = ?,
        max_open_tasks_cap = ?,
        updated_at = ?,
        completed_at = ?,
        dropped_reason = ?
      WHERE id = ?
    `);

    stmt.run(
      goal.title,
      goal.verbatimPrompt,
      goal.status,
      goal.maxOpenTasksCap,
      goal.updatedAt,
      goal.completedAt || null,
      goal.droppedReason || null,
      goal.id
    );

    return goal;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM goals WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  countOpenTasks(goalId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE goal_id = ? AND status IN ('todo', 'doing', 'blocked-on-dependency', 'waiting-on-human') AND is_archived = 0
    `);
    const row = stmt.get(goalId) as { count: number };
    return row ? row.count : 0;
  }
}
