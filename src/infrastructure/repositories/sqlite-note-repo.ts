import { Database as DatabaseType } from 'better-sqlite3';
import { AuthorType, NoteType, TaskNote } from '../../domain/types.js';
import { INoteRepository } from './interfaces.js';

export class SqliteNoteRepository implements INoteRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): TaskNote {
    let gitContext = undefined;
    try {
      if (row.git_context) {
        gitContext = JSON.parse(row.git_context);
      }
    } catch {
      gitContext = undefined;
    }

    return {
      id: row.id,
      taskId: row.task_id,
      authorType: row.author_type as AuthorType,
      authorId: row.author_id,
      noteType: row.note_type as NoteType,
      content: row.content,
      gitContext,
      createdAt: row.created_at,
    };
  }

  create(note: TaskNote): TaskNote {
    const stmt = this.db.prepare(`
      INSERT INTO task_notes (
        id, task_id, author_type, author_id, note_type, content, git_context, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      note.id,
      note.taskId,
      note.authorType,
      note.authorId,
      note.noteType,
      note.content,
      note.gitContext ? JSON.stringify(note.gitContext) : null,
      note.createdAt
    );

    return note;
  }

  listByTaskId(taskId: string): TaskNote[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at ASC
    `);
    const rows = stmt.all(taskId);
    return rows.map((r) => this.mapRow(r));
  }

  listRecent(limit: number = 50): TaskNote[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_notes ORDER BY created_at DESC LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.map((r) => this.mapRow(r));
  }
}
