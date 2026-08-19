import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface DatabaseConfig {
  dbPath?: string;
  projectPath?: string;
  inMemory?: boolean;
}

export class DatabaseManager {
  private static instance: DatabaseType | null = null;
  private static activeDbPath: string | null = null;

  /**
   * Discovers the repository root or current project directory.
   */
  static findProjectRoot(startPath: string = process.cwd()): string {
    let current = path.resolve(startPath);
    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, '.moo'))) {
        return current;
      }
      current = path.dirname(current);
    }
    return path.resolve(startPath);
  }

  /**
   * Resolves the default SQLite DB path in `.moo/tasks.db`.
   */
  static resolveDbPath(projectPath?: string): string {
    const root = projectPath ? path.resolve(projectPath) : this.findProjectRoot();
    const mooDir = path.join(root, '.moo');
    if (!fs.existsSync(mooDir)) {
      fs.mkdirSync(mooDir, { recursive: true });
    }
    return path.join(mooDir, 'tasks.db');
  }

  /**
   * Initializes or returns the SQLite database connection with WAL mode enabled.
   */
  static getDatabase(config: DatabaseConfig = {}): DatabaseType {
    if (this.instance && !config.inMemory) {
      return this.instance;
    }

    let db: DatabaseType;

    if (config.inMemory) {
      db = new Database(':memory:');
    } else {
      const dbPath = config.dbPath || this.resolveDbPath(config.projectPath);
      this.activeDbPath = dbPath;
      db = new Database(dbPath);
    }

    // Performance and reliability pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');

    this.instance = db;
    return db;
  }

  static getActiveDbPath(): string | null {
    return this.activeDbPath;
  }

  static close(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
      this.activeDbPath = null;
    }
  }
}
