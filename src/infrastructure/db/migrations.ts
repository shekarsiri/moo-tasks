import { Database as DatabaseType } from 'better-sqlite3';

export class DatabaseMigrator {
  static runMigrations(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        verbatim_prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        max_open_tasks_cap INTEGER NOT NULL DEFAULT 10,
        project_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        dropped_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        parent_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by_agent);
      CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_path);
      CREATE INDEX IF NOT EXISTS idx_status_history_task ON status_history(task_id);
    `);
  }
}
