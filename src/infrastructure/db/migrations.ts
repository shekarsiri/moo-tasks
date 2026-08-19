import { Database as DatabaseType } from 'better-sqlite3';

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

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_workspaces_root ON workspaces(root_path);
      CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_path);
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by_agent);
      CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON decisions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_path);
      CREATE INDEX IF NOT EXISTS idx_status_history_task ON status_history(task_id);
    `);

    // Dynamic column additions for existing installations
    try {
      db.exec(`ALTER TABLE goals ADD COLUMN workspace_id TEXT;`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT;`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE decisions ADD COLUMN workspace_id TEXT;`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE goals ADD COLUMN description TEXT;`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN human_options TEXT;`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'feature';`);
    } catch {
      // column already exists
    }

    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`);
    } catch {
      // column already exists
    }

    // FTS5 Virtual Tables & Triggers for Full-Text Search
    try {
      db.exec(`
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
      `);
    } catch {
      // FTS5 extension already enabled or table exists
    }

    // Record schema version
    try {
      const row = db.prepare(`SELECT version FROM schema_version WHERE version = ?`).get(1);
      if (!row) {
        db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(1, new Date().toISOString());
      }
    } catch {
      // ignore
    }
  }
}
