import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

export function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export interface DatabaseConfig {
  dbPath?: string;
  projectPath?: string;
  inMemory?: boolean;
  /** Write decisions to docs/adr/ in the project. Default: on, except for in-memory databases. */
  adrSync?: boolean;
}

export class DatabaseManager {
  private static instance: DatabaseType | null = null;
  private static activeDbPath: string | null = null;

  /**
   * Returns the global user-level directory for Moo Tasks (~/.moo).
   */
  static getGlobalMooDir(): string {
    const dir = process.env.MOO_HOME || path.join(os.homedir(), '.moo');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore if already created
      }
    }
    return dir;
  }

  /**
   * Resolves the global SQLite database path in ~/.moo/tasks.db.
   */
  static resolveGlobalDbPath(): string {
    if (process.env.MOO_DB_PATH) {
      const customPath = path.resolve(process.env.MOO_DB_PATH);
      const dir = path.dirname(customPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return customPath;
    }
    const mooDir = this.getGlobalMooDir();
    return path.join(mooDir, 'tasks.db');
  }

  /**
   * Discovers the repository root or current project directory.
   */
  static findProjectRoot(startPath: string = process.cwd()): string {
    return this.detectProject(startPath).root;
  }

  /**
   * The nearest directory that is a project: a git checkout (`.git` dir or worktree file), or one
   * marked for Moo (`.moo.json`, or a `.moo` dir that is not the global Moo home). Without one, the
   * start directory is returned with isProject false, so callers can decline to register it.
   */
  static detectProject(startPath: string = process.cwd()): { root: string; isProject: boolean; isGit: boolean } {
    const start = path.resolve(startPath);
    const globalHome = realpathOrResolve(process.env.MOO_HOME || path.join(os.homedir(), '.moo'));
    let current = start;
    while (true) {
      if (fs.existsSync(path.join(current, '.git'))) return { root: current, isProject: true, isGit: true };
      if (fs.existsSync(path.join(current, '.moo.json'))) return { root: current, isProject: true, isGit: false };
      const mooDir = path.join(current, '.moo');
      if (fs.existsSync(mooDir) && realpathOrResolve(mooDir) !== globalHome) {
        return { root: current, isProject: true, isGit: false };
      }
      const parent = path.dirname(current);
      if (parent === current) return { root: start, isProject: false, isGit: false };
      current = parent;
    }
  }

  /**
   * Resolves the SQLite DB path. By default, uses the global DB (~/.moo/tasks.db).
   */
  static resolveDbPath(projectPath?: string): string {
    // If explicit local DB requested via environment or flag
    if (process.env.MOO_LOCAL_DB === 'true' && projectPath) {
      const root = path.resolve(projectPath);
      const mooDir = path.join(root, '.moo');
      if (!fs.existsSync(mooDir)) {
        fs.mkdirSync(mooDir, { recursive: true });
      }
      return path.join(mooDir, 'tasks.db');
    }

    return this.resolveGlobalDbPath();
  }

  /**
   * Initializes or returns the SQLite database connection with WAL mode enabled.
   */
  static getDatabase(config: DatabaseConfig = {}): DatabaseType {
    if (config.inMemory) {
      this.close();
      const db = new Database(':memory:');
      this.activeDbPath = ':memory:';
      this.configurePragmas(db);
      this.instance = db;
      return db;
    }

    const targetDbPath = config.dbPath || this.resolveDbPath(config.projectPath);

    if (this.instance && this.activeDbPath === targetDbPath) {
      return this.instance;
    }

    if (this.instance) {
      this.close();
    }

    const dir = path.dirname(path.resolve(targetDbPath));
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore if already created
      }
    }

    this.activeDbPath = targetDbPath;
    const db = new Database(targetDbPath);
    this.configurePragmas(db);
    this.instance = db;
    return db;
  }

  private static configurePragmas(db: DatabaseType): void {
    // Performance and reliability pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
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
