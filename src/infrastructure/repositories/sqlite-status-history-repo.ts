import { Database as DatabaseType } from 'better-sqlite3';
import { AuthorType, StatusHistoryEntry, TaskStatus } from '../../domain/types.js';
import { IStatusHistoryRepository } from './interfaces.js';

export class SqliteStatusHistoryRepository implements IStatusHistoryRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): StatusHistoryEntry {
    return {
      id: row.id,
      taskId: row.task_id,
      fromStatus: row.from_status as TaskStatus,
      toStatus: row.to_status as TaskStatus,
      changedBy: row.changed_by,
      authorType: row.author_type as AuthorType,
      reason: row.reason || undefined,
      timestamp: row.timestamp,
    };
  }

  create(entry: StatusHistoryEntry): StatusHistoryEntry {
    const stmt = this.db.prepare(`
      INSERT INTO status_history (
        id, task_id, from_status, to_status, changed_by, author_type, reason, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.taskId,
      entry.fromStatus,
      entry.toStatus,
      entry.changedBy,
      entry.authorType,
      entry.reason || null,
      entry.timestamp
    );

    return entry;
  }

  listByTaskId(taskId: string): StatusHistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM status_history WHERE task_id = ? ORDER BY timestamp ASC
    `);
    const rows = stmt.all(taskId);
    return rows.map((r) => this.mapRow(r));
  }

  findLatestByTaskId(taskId: string): StatusHistoryEntry | null {
    const stmt = this.db.prepare(`
      SELECT * FROM status_history WHERE task_id = ? ORDER BY timestamp DESC LIMIT 1
    `);
    const row = stmt.get(taskId);
    return row ? this.mapRow(row) : null;
  }

  findPreviousState(taskId: string): StatusHistoryEntry | null {
    const stmt = this.db.prepare(`
      SELECT * FROM status_history WHERE task_id = ? ORDER BY timestamp DESC LIMIT 1 OFFSET 1
    `);
    const row = stmt.get(taskId);
    return row ? this.mapRow(row) : null;
  }
}
