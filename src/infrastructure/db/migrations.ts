import { Database as DatabaseType } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseType) => void;
}

function hasColumn(db: DatabaseType, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

function addColumn(db: DatabaseType, table: string, definition: string): void {
  const column = definition.split(/\s+/)[0];
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
}

/**
 * Ordered, append-only schema changes. Each runs once, in its own IMMEDIATE transaction, and is
 * recorded in schema_version; a failure rolls that step back and surfaces instead of being swallowed.
 * Steps must stay idempotent: databases created before versioning already have some of them applied.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'workspace scoping, task type/tags, human options, git baseline',
    up: (db) => {
      addColumn(db, 'tasks', 'claim_git_baseline TEXT');
      addColumn(db, 'goals', 'workspace_id TEXT');
      addColumn(db, 'tasks', 'workspace_id TEXT');
      addColumn(db, 'decisions', 'workspace_id TEXT');
      addColumn(db, 'goals', 'description TEXT');
      addColumn(db, 'tasks', 'human_options TEXT');
      addColumn(db, 'tasks', "type TEXT NOT NULL DEFAULT 'feature'");
      addColumn(db, 'tasks', "tags TEXT NOT NULL DEFAULT '[]'");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON decisions(workspace_id);
      `);
    },
  },
  {
    version: 3,
    name: 'full-text search tables and triggers',
    up: (db) => db.exec(FTS_SQL),
  },
  {
    version: 4,
    name: 'backfill workspace ids',
    up: (db) => db.exec(WORKSPACE_BACKFILL_SQL),
  },
  {
    version: 5,
    name: 'unique task idempotency keys',
    up: (db) => {
      // Keep the key on the oldest task of each duplicate group; later copies lose it.
      db.exec(`
        UPDATE tasks SET idempotency_key = NULL
        WHERE idempotency_key IS NOT NULL
          AND rowid NOT IN (SELECT MIN(rowid) FROM tasks WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key);
        DROP INDEX IF EXISTS idx_tasks_idempotency;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_unique ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
      `);
    },
  },
  {
    version: 6,
    name: 'workspace verify command, task commits, goal summary',
    up: (db) => {
      addColumn(db, 'workspaces', 'verify_command TEXT');
      addColumn(db, 'workspaces', 'verify_timeout_seconds INTEGER');
      addColumn(db, 'tasks', "commits TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'goals', 'summary TEXT');
    },
  },
  {
    version: 7,
    name: 'remember who was interrupted when a lease is auto-released',
    up: (db) => addColumn(db, 'tasks', 'interrupted_from TEXT'),
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export class DatabaseMigrator {
  static runMigrations(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        git_remote TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        title TEXT NOT NULL,
        verbatim_prompt TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        max_open_tasks_cap INTEGER NOT NULL DEFAULT 10,
        project_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        dropped_reason TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        goal_id TEXT,
        parent_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'feature',
        tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        order_index INTEGER NOT NULL DEFAULT 0,
        acceptance_criteria TEXT NOT NULL DEFAULT '',
        
        -- Ownership & Concurrency
        claimed_by_agent TEXT,
        claimed_session_id TEXT,
        claimed_at TEXT,
        lease_expires_at TEXT,
        declared_files TEXT NOT NULL DEFAULT '[]',

        -- Verification & Proof
        verification_state TEXT NOT NULL DEFAULT 'unverified',
        evidence TEXT,
        verified_by TEXT,
        verified_at TEXT,
        rejection_reason TEXT,

        -- Attempt / Stall Tracking
        attempt_count INTEGER NOT NULL DEFAULT 0,
        close_count INTEGER NOT NULL DEFAULT 0,
        reopen_count INTEGER NOT NULL DEFAULT 0,
        max_attempts_allowed INTEGER NOT NULL DEFAULT 3,

        -- Blocking & Human Collaboration
        blocked_reason TEXT,
        human_question TEXT,
        human_question_type TEXT,
        human_options TEXT,
        human_answer TEXT,
        human_answered_at TEXT,
        human_answered_by TEXT,

        -- Discovered Work & Idempotency
        discovered_from_task_id TEXT,
        is_deferred INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        dropped_reason TEXT,

        -- Timestamps
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_state_change_at TEXT NOT NULL,

        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
        FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        note_type TEXT NOT NULL,
        content TEXT NOT NULL,
        git_context TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        choice TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'accepted',
        superseded_by_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        project_path TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
        FOREIGN KEY (superseded_by_id) REFERENCES decisions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS status_history (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        author_type TEXT NOT NULL,
        reason TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      -- Indexes on columns every schema version has
      CREATE INDEX IF NOT EXISTS idx_workspaces_root ON workspaces(root_path);
      CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_path);
      CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by_agent);
      CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_path);
      CREATE INDEX IF NOT EXISTS idx_status_history_task ON status_history(task_id);
    `);

    // Version 1 is the baseline above; databases from before versioning may lack its row.
    db.prepare(`INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, ?)`).run(new Date().toISOString());

    for (const migration of MIGRATIONS) {
      db.transaction(() => {
        // Re-checked inside the lock: another process may have applied it a moment ago.
        const applied = db.prepare(`SELECT 1 FROM schema_version WHERE version = ?`).get(migration.version);
        if (applied) return;
        migration.up(db);
        db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(
          migration.version,
          new Date().toISOString()
        );
      }).immediate();
    }
  }
}

const FTS_SQL = `
        CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
          id UNINDEXED,
          title,
          description,
          acceptance_criteria,
          tags,
          tokenize='unicode61'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
          id UNINDEXED,
          title,
          context,
          choice,
          rationale,
          tags,
          tokenize='unicode61'
        );

        -- Tasks FTS triggers
        CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
          INSERT INTO tasks_fts(id, title, description, acceptance_criteria, tags)
          VALUES (new.id, new.title, coalesce(new.description, ''), coalesce(new.acceptance_criteria, ''), coalesce(new.tags, '[]'));
        END;

        CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
          DELETE FROM tasks_fts WHERE id = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
          DELETE FROM tasks_fts WHERE id = old.id;
          INSERT INTO tasks_fts(id, title, description, acceptance_criteria, tags)
          VALUES (new.id, new.title, coalesce(new.description, ''), coalesce(new.acceptance_criteria, ''), coalesce(new.tags, '[]'));
        END;

        -- Decisions FTS triggers
        CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
          INSERT INTO decisions_fts(id, title, context, choice, rationale, tags)
          VALUES (new.id, new.title, new.context, new.choice, new.rationale, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
          DELETE FROM decisions_fts WHERE id = old.id;
        END;

        CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
          DELETE FROM decisions_fts WHERE id = old.id;
          INSERT INTO decisions_fts(id, title, context, choice, rationale, tags)
          VALUES (new.id, new.title, new.context, new.choice, new.rationale, new.tags);
        END;

        -- Backfill FTS index for existing rows
        INSERT INTO tasks_fts(id, title, description, acceptance_criteria, tags)
        SELECT id, title, coalesce(description, ''), coalesce(acceptance_criteria, ''), coalesce(tags, '[]') FROM tasks
        WHERE id NOT IN (SELECT id FROM tasks_fts);

        INSERT INTO decisions_fts(id, title, context, choice, rationale, tags)
        SELECT id, title, context, choice, rationale, tags FROM decisions
        WHERE id NOT IN (SELECT id FROM decisions_fts);
`;

const WORKSPACE_BACKFILL_SQL = `
        -- Goals backfill from workspaces by project_path
        UPDATE goals
        SET workspace_id = (SELECT id FROM workspaces WHERE workspaces.root_path = goals.project_path LIMIT 1)
        WHERE (workspace_id IS NULL OR workspace_id = '')
          AND EXISTS (SELECT 1 FROM workspaces WHERE workspaces.root_path = goals.project_path);

        -- Tasks backfill from goals
        UPDATE tasks
        SET workspace_id = (SELECT workspace_id FROM goals WHERE goals.id = tasks.goal_id LIMIT 1)
        WHERE (workspace_id IS NULL OR workspace_id = '')
          AND goal_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM goals WHERE goals.id = tasks.goal_id AND goals.workspace_id IS NOT NULL AND goals.workspace_id != '');

        -- Decisions backfill from workspaces by project_path
        UPDATE decisions
        SET workspace_id = (SELECT id FROM workspaces WHERE workspaces.root_path = decisions.project_path LIMIT 1)
        WHERE (workspace_id IS NULL OR workspace_id = '')
          AND EXISTS (SELECT 1 FROM workspaces WHERE workspaces.root_path = decisions.project_path);
`;
