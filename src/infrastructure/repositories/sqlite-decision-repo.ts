import { Database as DatabaseType } from 'better-sqlite3';
import { AuthorType, Decision, DecisionStatus } from '../../domain/types.js';
import { IDecisionRepository } from './interfaces.js';

export class SqliteDecisionRepository implements IDecisionRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): Decision {
    let tags: string[] = [];
    try {
      tags = row.tags ? JSON.parse(row.tags) : [];
    } catch {
      tags = [];
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id || undefined,
      title: row.title,
      context: row.context,
      choice: row.choice,
      rationale: row.rationale,
      status: row.status as DecisionStatus,
      supersededById: row.superseded_by_id || undefined,
      tags,
      projectPath: row.project_path,
      authorId: row.author_id,
      authorType: row.author_type as AuthorType,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(decision: Decision): Decision {
    const stmt = this.db.prepare(`
      INSERT INTO decisions (
        id, workspace_id, title, context, choice, rationale, status, superseded_by_id,
        tags, project_path, author_id, author_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.id,
      decision.workspaceId || null,
      decision.title,
      decision.context,
      decision.choice,
      decision.rationale,
      decision.status,
      decision.supersededById || null,
      JSON.stringify(decision.tags || []),
      decision.projectPath,
      decision.authorId,
      decision.authorType,
      decision.createdAt,
      decision.updatedAt
    );

    return decision;
  }

  findById(id: string): Decision | null {
    const stmt = this.db.prepare(`SELECT * FROM decisions WHERE id = ?`);
    const row = stmt.get(id);
    return row ? this.mapRow(row) : null;
  }

  list(projectPath?: string, status?: DecisionStatus, tag?: string, workspaceId?: string): Decision[] {
    let query = `SELECT * FROM decisions WHERE 1=1`;
    const params: any[] = [];

    if (workspaceId) {
      query += ` AND workspace_id = ?`;
      params.push(workspaceId);
    } else if (projectPath) {
      query += ` AND project_path = ?`;
      params.push(projectPath);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;
    const rows = this.db.prepare(query).all(...params);
    let results = rows.map((r) => this.mapRow(r));

    if (tag) {
      results = results.filter((d) => d.tags.includes(tag));
    }

    return results;
  }

  update(decision: Decision): Decision {
    const stmt = this.db.prepare(`
      UPDATE decisions SET
        workspace_id = ?,
        title = ?,
        context = ?,
        choice = ?,
        rationale = ?,
        status = ?,
        superseded_by_id = ?,
        tags = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      decision.workspaceId || null,
      decision.title,
      decision.context,
      decision.choice,
      decision.rationale,
      decision.status,
      decision.supersededById || null,
      JSON.stringify(decision.tags || []),
      decision.updatedAt,
      decision.id
    );

    return decision;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM decisions WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
