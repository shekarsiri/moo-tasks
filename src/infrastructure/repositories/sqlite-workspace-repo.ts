import { Database as DatabaseType } from 'better-sqlite3';
import { Workspace } from '../../domain/types.js';
import { IWorkspaceRepository } from './interfaces.js';

export class SqliteWorkspaceRepository implements IWorkspaceRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): Workspace {
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      gitRemote: row.git_remote || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(workspace: Workspace): Workspace {
    const stmt = this.db.prepare(`
      INSERT INTO workspaces (
        id, name, root_path, git_remote, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      workspace.id,
      workspace.name,
      workspace.rootPath,
      workspace.gitRemote || null,
      workspace.createdAt,
      workspace.updatedAt
    );

    return workspace;
  }

  findById(id: string): Workspace | null {
    const stmt = this.db.prepare(`SELECT * FROM workspaces WHERE id = ?`);
    const row = stmt.get(id);
    return row ? this.mapRow(row) : null;
  }

  findByPath(rootPath: string): Workspace | null {
    const stmt = this.db.prepare(`SELECT * FROM workspaces WHERE root_path = ?`);
    const row = stmt.get(rootPath);
    return row ? this.mapRow(row) : null;
  }

  findByName(name: string): Workspace | null {
    const stmt = this.db.prepare(`SELECT * FROM workspaces WHERE name = ? COLLATE NOCASE`);
    const row = stmt.get(name);
    return row ? this.mapRow(row) : null;
  }

  list(): Workspace[] {
    const stmt = this.db.prepare(`SELECT * FROM workspaces ORDER BY name ASC`);
    const rows = stmt.all();
    return rows.map((r) => this.mapRow(r));
  }

  update(workspace: Workspace): Workspace {
    const stmt = this.db.prepare(`
      UPDATE workspaces SET
        name = ?,
        root_path = ?,
        git_remote = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      workspace.name,
      workspace.rootPath,
      workspace.gitRemote || null,
      workspace.updatedAt,
      workspace.id
    );

    return workspace;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM workspaces WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
