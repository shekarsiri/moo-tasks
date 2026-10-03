import { Database as DatabaseType } from 'better-sqlite3';
import { GitBaseline } from '../../domain/types.js';

export interface AgentSession {
  sessionId: string;
  workspaceId: string;
  baseline?: GitBaseline;
  startedAt: string;
  nudgedAt?: string;
}

/** Sessions older than this are forgotten when a new one starts. */
const KEEP_DAYS = 14;

/**
 * Agent sessions as Claude Code hooks see them (keyed by the client's session id): where the working
 * tree stood when the session started, so the Stop hook can tell what this session changed.
 */
export class SqliteAgentSessionRepository {
  constructor(private db: DatabaseType) {}

  /** A new session replaces any row with its id; a resumed or compacted one keeps its first baseline. */
  start(session: AgentSession, keepExisting: boolean): void {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    this.db.prepare(`DELETE FROM agent_sessions WHERE started_at < ?`).run(cutoff);
    this.db
      .prepare(
        `INSERT ${keepExisting ? 'OR IGNORE' : 'OR REPLACE'} INTO agent_sessions (session_id, workspace_id, baseline, started_at, nudged_at)
         VALUES (?, ?, ?, ?, NULL)`
      )
      .run(session.sessionId, session.workspaceId, session.baseline ? JSON.stringify(session.baseline) : null, session.startedAt);
  }

  find(sessionId: string): AgentSession | null {
    const row = this.db.prepare(`SELECT * FROM agent_sessions WHERE session_id = ?`).get(sessionId) as any;
    if (!row) return null;
    let baseline: GitBaseline | undefined;
    try {
      baseline = row.baseline ? JSON.parse(row.baseline) : undefined;
    } catch {
      baseline = undefined;
    }
    return { sessionId: row.session_id, workspaceId: row.workspace_id, baseline, startedAt: row.started_at, nudgedAt: row.nudged_at || undefined };
  }

  markNudged(sessionId: string, at: string): void {
    this.db.prepare(`UPDATE agent_sessions SET nudged_at = ? WHERE session_id = ?`).run(at, sessionId);
  }
}
