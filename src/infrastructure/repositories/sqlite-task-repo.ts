import { Database as DatabaseType } from 'better-sqlite3';
import {
  Task,
  TaskDependency,
  TaskPriority,
  TaskStatus,
  TaskType,
  VerificationState,
} from '../../domain/types.js';
import { ITaskRepository, TaskFilter } from './interfaces.js';

export class SqliteTaskRepository implements ITaskRepository {
  constructor(private db: DatabaseType) {}

  private mapRow(row: any): Task {
    let declaredFiles: string[] = [];
    try {
      declaredFiles = row.declared_files ? JSON.parse(row.declared_files) : [];
    } catch {
      declaredFiles = [];
    }

    let tags: string[] = [];
    try {
      tags = row.tags ? JSON.parse(row.tags) : [];
    } catch {
      tags = [];
    }

    let evidence = undefined;
    try {
      if (row.evidence) {
        evidence = JSON.parse(row.evidence);
      }
    } catch {
      evidence = undefined;
    }

    let humanOptions: string[] | undefined = undefined;
    try {
      if (row.human_options) {
        humanOptions = JSON.parse(row.human_options);
      }
    } catch {
      humanOptions = undefined;
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id || undefined,
      goalId: row.goal_id || undefined,
      parentId: row.parent_id || undefined,
      title: row.title,
      description: row.description || undefined,
      type: (row.type as TaskType) || 'feature',
      tags,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      orderIndex: row.order_index,
      acceptanceCriteria: row.acceptance_criteria || '',
      
      claimedByAgent: row.claimed_by_agent || undefined,
      claimedSessionId: row.claimed_session_id || undefined,
      claimedAt: row.claimed_at || undefined,
      leaseExpiresAt: row.lease_expires_at || undefined,
      declaredFiles,

      verificationState: row.verification_state as VerificationState,
      evidence,
      verifiedBy: row.verified_by || undefined,
      verifiedAt: row.verified_at || undefined,
      rejectionReason: row.rejection_reason || undefined,

      attemptCount: row.attempt_count,
      closeCount: row.close_count,
      reopenCount: row.reopen_count,
      maxAttemptsAllowed: row.max_attempts_allowed,

      blockedReason: row.blocked_reason || undefined,
      humanQuestion: row.human_question || undefined,
      humanQuestionType: row.human_question_type || undefined,
      humanOptions,
      humanAnswer: row.human_answer || undefined,
      humanAnsweredAt: row.human_answered_at || undefined,
      humanAnsweredBy: row.human_answered_by || undefined,

      discoveredFromTaskId: row.discovered_from_task_id || undefined,
      isDeferred: Boolean(row.is_deferred),
      idempotencyKey: row.idempotency_key || undefined,
      isArchived: Boolean(row.is_archived),
      droppedReason: row.dropped_reason || undefined,

      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      lastStateChangeAt: row.last_state_change_at,
    };
  }

  create(task: Task): Task {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, workspace_id, goal_id, parent_id, title, description, type, tags, status, priority, order_index,
        acceptance_criteria, claimed_by_agent, claimed_session_id, claimed_at,
        lease_expires_at, declared_files, verification_state, evidence,
        verified_by, verified_at, rejection_reason, attempt_count, close_count,
        reopen_count, max_attempts_allowed, blocked_reason, human_question,
        human_question_type, human_options, human_answer, human_answered_at, human_answered_by,
        discovered_from_task_id, is_deferred, idempotency_key, is_archived,
        dropped_reason, created_at, updated_at, completed_at, last_state_change_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      task.id,
      task.workspaceId || null,
      task.goalId || null,
      task.parentId || null,
      task.title,
      task.description || null,
      task.type || 'feature',
      JSON.stringify(task.tags || []),
      task.status,
      task.priority,
      task.orderIndex,
      task.acceptanceCriteria,
      task.claimedByAgent || null,
      task.claimedSessionId || null,
      task.claimedAt || null,
      task.leaseExpiresAt || null,
      JSON.stringify(task.declaredFiles || []),
      task.verificationState,
      task.evidence ? JSON.stringify(task.evidence) : null,
      task.verifiedBy || null,
      task.verifiedAt || null,
      task.rejectionReason || null,
      task.attemptCount,
      task.closeCount,
      task.reopenCount,
      task.maxAttemptsAllowed,
      task.blockedReason || null,
      task.humanQuestion || null,
      task.humanQuestionType || null,
      task.humanOptions ? JSON.stringify(task.humanOptions) : null,
      task.humanAnswer || null,
      task.humanAnsweredAt || null,
      task.humanAnsweredBy || null,
      task.discoveredFromTaskId || null,
      task.isDeferred ? 1 : 0,
      task.idempotencyKey || null,
      task.isArchived ? 1 : 0,
      task.droppedReason || null,
      task.createdAt,
      task.updatedAt,
      task.completedAt || null,
      task.lastStateChangeAt
    );

    return task;
  }

  createBatch(tasks: Task[]): Task[] {
    const insertTx = this.db.transaction((items: Task[]) => {
      for (const item of items) {
        this.create(item);
      }
    });
    insertTx(tasks);
    return tasks;
  }

  findById(id: string): Task | null {
    let stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    let row = stmt.get(id);
    if (row) return this.mapRow(row);

    // Support short code sequence lookup (e.g. MO-123, SH-123, or numeric 123)
    const match = String(id).match(/^(?:[A-Za-z]{2,}-)?(\d+)$/);
    if (match) {
      const orderIdx = parseInt(match[1], 10);
      stmt = this.db.prepare(`SELECT * FROM tasks WHERE order_index = ?`);
      row = stmt.get(orderIdx);
      if (row) return this.mapRow(row);
    }

    return null;
  }

  findByIdempotencyKey(key: string): Task | null {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE idempotency_key = ?`);
    const row = stmt.get(key);
    return row ? this.mapRow(row) : null;
  }

  list(filter: TaskFilter = {}): Task[] {
    let query = `SELECT * FROM tasks WHERE 1=1`;
    const params: any[] = [];

    if (filter.workspaceId) {
      query += ` AND (workspace_id = ? OR (workspace_id IS NULL AND goal_id IN (SELECT id FROM goals WHERE workspace_id = ?)))`;
      params.push(filter.workspaceId, filter.workspaceId);
    }

    if (filter.goalId !== undefined) {
      if (filter.goalId === '') {
        query += ` AND goal_id IS NULL`;
      } else {
        query += ` AND goal_id = ?`;
        params.push(filter.goalId);
      }
    }

    if (filter.parentId !== undefined) {
      if (filter.parentId === null) {
        query += ` AND parent_id IS NULL`;
      } else {
        query += ` AND parent_id = ?`;
        params.push(filter.parentId);
      }
    }

    if (filter.status) {
      query += ` AND status = ?`;
      params.push(filter.status);
    }

    if (filter.statuses && filter.statuses.length > 0) {
      const placeholders = filter.statuses.map(() => '?').join(',');
      query += ` AND status IN (${placeholders})`;
      params.push(...filter.statuses);
    }

    if (filter.priority) {
      query += ` AND priority = ?`;
      params.push(filter.priority);
    }

    if (filter.type) {
      query += ` AND type = ?`;
      params.push(filter.type);
    }

    if (filter.tag) {
      query += ` AND tags LIKE ?`;
      params.push(`%"${filter.tag}"%`);
    }

    if (filter.tags && filter.tags.length > 0) {
      for (const t of filter.tags) {
        query += ` AND tags LIKE ?`;
        params.push(`%"${t}"%`);
      }
    }

    if (filter.claimedByAgent) {
      query += ` AND claimed_by_agent = ?`;
      params.push(filter.claimedByAgent);
    }

    if (filter.isDeferred !== undefined) {
      const isDef = typeof filter.isDeferred === 'string'
        ? filter.isDeferred === 'true' || filter.isDeferred === '1'
        : Boolean(filter.isDeferred);
      query += ` AND is_deferred = ?`;
      params.push(isDef ? 1 : 0);
    }

    if (filter.isArchived !== undefined) {
      const isArch = typeof filter.isArchived === 'string'
        ? filter.isArchived === 'true' || filter.isArchived === '1'
        : Boolean(filter.isArchived);
      query += ` AND is_archived = ?`;
      params.push(isArch ? 1 : 0);
    }

    if (filter.searchQuery) {
      query += ` AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)`;
      params.push(`%${filter.searchQuery}%`, `%${filter.searchQuery}%`, `%${filter.searchQuery}%`);
    }

    query += ` ORDER BY order_index ASC, created_at ASC`;

    if (filter.limit) {
      query += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const rows = this.db.prepare(query).all(...params);
    return rows.map((r) => this.mapRow(r));
  }

  listByGoalId(goalId: string): Task[] {
    return this.list({ goalId });
  }

  listSubtasks(parentId: string): Task[] {
    return this.list({ parentId });
  }

  listOrphanTasks(): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE goal_id IS NULL AND is_archived = 0 ORDER BY created_at DESC`);
    const rows = stmt.all();
    return rows.map((r) => this.mapRow(r));
  }

  update(task: Task): Task {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        workspace_id = ?,
        goal_id = ?,
        parent_id = ?,
        title = ?,
        description = ?,
        type = ?,
        tags = ?,
        status = ?,
        priority = ?,
        order_index = ?,
        acceptance_criteria = ?,
        claimed_by_agent = ?,
        claimed_session_id = ?,
        claimed_at = ?,
        lease_expires_at = ?,
        declared_files = ?,
        verification_state = ?,
        evidence = ?,
        verified_by = ?,
        verified_at = ?,
        rejection_reason = ?,
        attempt_count = ?,
        close_count = ?,
        reopen_count = ?,
        max_attempts_allowed = ?,
        blocked_reason = ?,
        human_question = ?,
        human_question_type = ?,
        human_options = ?,
        human_answer = ?,
        human_answered_at = ?,
        human_answered_by = ?,
        discovered_from_task_id = ?,
        is_deferred = ?,
        idempotency_key = ?,
        is_archived = ?,
        dropped_reason = ?,
        updated_at = ?,
        completed_at = ?,
        last_state_change_at = ?
      WHERE id = ?
    `);

    stmt.run(
      task.workspaceId || null,
      task.goalId || null,
      task.parentId || null,
      task.title,
      task.description || null,
      task.type || 'feature',
      JSON.stringify(task.tags || []),
      task.status,
      task.priority,
      task.orderIndex,
      task.acceptanceCriteria,
      task.claimedByAgent || null,
      task.claimedSessionId || null,
      task.claimedAt || null,
      task.leaseExpiresAt || null,
      JSON.stringify(task.declaredFiles || []),
      task.verificationState,
      task.evidence ? JSON.stringify(task.evidence) : null,
      task.verifiedBy || null,
      task.verifiedAt || null,
      task.rejectionReason || null,
      task.attemptCount,
      task.closeCount,
      task.reopenCount,
      task.maxAttemptsAllowed,
      task.blockedReason || null,
      task.humanQuestion || null,
      task.humanQuestionType || null,
      task.humanOptions ? JSON.stringify(task.humanOptions) : null,
      task.humanAnswer || null,
      task.humanAnsweredAt || null,
      task.humanAnsweredBy || null,
      task.discoveredFromTaskId || null,
      task.isDeferred ? 1 : 0,
      task.idempotencyKey || null,
      task.isArchived ? 1 : 0,
      task.droppedReason || null,
      task.updatedAt,
      task.completedAt || null,
      task.lastStateChangeAt,
      task.id
    );

    return task;
  }

  updateBatch(tasks: Task[]): void {
    const updateTx = this.db.transaction((items: Task[]) => {
      for (const item of items) {
        this.update(item);
      }
    });
    updateTx(tasks);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  addDependency(taskId: string, dependsOnTaskId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, dependsOnTaskId, new Date().toISOString());
  }

  removeDependency(taskId: string, dependsOnTaskId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?
    `);
    stmt.run(taskId, dependsOnTaskId);
  }

  getDependencies(taskId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?
    `);
    const rows = stmt.all(taskId) as { depends_on_task_id: string }[];
    return rows.map((r) => r.depends_on_task_id);
  }

  getDependents(taskId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?
    `);
    const rows = stmt.all(taskId) as { task_id: string }[];
    return rows.map((r) => r.task_id);
  }

  getAllDependencies(): TaskDependency[] {
    const stmt = this.db.prepare(`SELECT task_id, depends_on_task_id, created_at FROM task_dependencies`);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      taskId: r.task_id,
      dependsOnTaskId: r.depends_on_task_id,
      createdAt: r.created_at,
    }));
  }

  updateOrderIndices(updates: { id: string; orderIndex: number }[]): void {
    const stmt = this.db.prepare(`UPDATE tasks SET order_index = ?, updated_at = ? WHERE id = ?`);
    const now = new Date().toISOString();
    const tx = this.db.transaction((items: { id: string; orderIndex: number }[]) => {
      for (const item of items) {
        stmt.run(item.orderIndex, now, item.id);
      }
    });
    tx(updates);
  }
}
