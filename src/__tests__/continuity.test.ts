import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServiceContainer, RegisteredContainer } from '../services/index.js';
import { setupMcpServer } from '../mcp/server.js';
import { boardServer } from './helpers.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('Session-start noise', () => {
  let c: RegisteredContainer;
  const age = (taskId: string, days: number) => c.db.prepare(`UPDATE tasks SET updated_at = ?, completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE ? END WHERE id = ?`).run(daysAgo(days), daysAgo(days), taskId);
  const task = (title: string, extra: Record<string, unknown> = {}) =>
    c.taskLifecycleService.createTask({ title, acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id, ...extra } as any).task;
  const finish = (id: string) => {
    c.claimService.claimTask(id, 'agent-A', 's1');
    return c.verificationService.completeTask(id, 'agent-A', { outputSnippet: 'ok' });
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const server = setupMcpServer(c);
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const res = await handler({ method: 'tools/call', params: { name, arguments: args } });
    return JSON.parse(res.content[0].text);
  };

  beforeEach(() => {
    c = createServiceContainer({ inMemory: true, projectPath: '/test/continuity' });
  });
  afterEach(() => {
    delete process.env.MOO_GOAL_AUTOCLOSE_DAYS;
  });

  it('warns about repeated reopens only while the task is still open', () => {
    const t = task('Flaky');
    c.db.prepare(`UPDATE tasks SET reopen_count = 2 WHERE id = ?`).run(t.id);
    expect(c.sessionService.detectAgentStallsAndThrashing(undefined, c.activeWorkspace.id).map((w) => w.taskId)).toContain(t.id);
    c.db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(t.id);
    expect(c.sessionService.detectAgentStallsAndThrashing(undefined, c.activeWorkspace.id)).toHaveLength(0);
  });

  it('closes finished goals once they have been idle long enough, with a summary', () => {
    const ws = c.activeWorkspace.id;
    const goal = (title: string) => c.goalService.createGoal(title, 'p', '/test/continuity', 10, undefined, ws);
    const idle = goal('Finished last week');
    const recent = goal('Finished today');
    const open = goal('Still going');
    const idleTask = task('a', { goalId: idle.id });
    finish(idleTask.id);
    age(idleTask.id, 5);
    c.db.prepare(`UPDATE goals SET updated_at = ? WHERE id = ?`).run(daysAgo(5), idle.id);
    finish(task('b', { goalId: recent.id }).id);
    finish(task('c', { goalId: open.id }).id);
    task('d', { goalId: open.id });
    const adhoc = c.goalService.getOrCreateAdhocGoal(ws);
    const adhocTask = task('e', { goalId: adhoc.id });
    finish(adhocTask.id);
    age(adhocTask.id, 10);

    const closed = c.goalService.closeIdleGoals(ws);
    expect(closed.map((g) => g.id)).toEqual([idle.id]);
    expect(c.goalService.getGoal(idle.id).status).toBe('completed');
    expect(c.goalService.getGoal(idle.id).summary).toContain('Closed automatically');
    expect(c.goalService.getGoal(recent.id).status).toBe('active');
    expect(c.goalService.getGoal(open.id).status).toBe('active');
    expect(c.goalService.getGoal(adhoc.id).status).toBe('active');

    process.env.MOO_GOAL_AUTOCLOSE_DAYS = 'off';
    expect(c.goalService.closeIdleGoals(ws)).toEqual([]);
  });

  it('lets the board close every finished goal at once', async () => {
    const g = c.goalService.createGoal('Done just now', 'p', '/test/continuity', 10, undefined, c.activeWorkspace.id);
    finish(task('x', { goalId: g.id }).id);
    const app = boardServer(c);
    const res = await app.inject({ method: 'POST', url: '/api/goals/close-finished', payload: {} });
    expect(res.json()).toMatchObject({ success: true, closedCount: 1 });
    expect(c.goalService.getGoal(g.id).status).toBe('completed');
    await app.close();
  });

  it('ranks stale tasks last and never claims them automatically', async () => {
    const forgotten = task('Publish smoke commit', { priority: 'critical' });
    age(forgotten.id, 39);
    const fresh = task('Fix login copy', { priority: 'low' });
    expect(c.taskLifecycleService.getNextUnblockedTask(undefined, undefined, false, c.activeWorkspace.id)?.id).toBe(fresh.id);

    const claimed = await call('moo_get_next_task', { claim: true, agentId: 'agent-A' });
    expect(claimed.task.id).toBe(fresh.id);
    await call('moo_complete_task', { taskId: fresh.id, agentId: 'agent-A', evidence: { outputSnippet: 'ok' } });

    // Only stale work is left: it is offered, not claimed
    const offered = await call('moo_get_next_task', { claim: true, agentId: 'agent-A' });
    expect(offered.claimed).toBe(false);
    expect(offered.nextTask.id).toBe(forgotten.id);
    expect(offered.stale).toContain('untouched for 39 days');
    expect(c.taskRepo.findById(forgotten.id)?.status).toBe('todo');

    const summary = c.sessionService.whereDidILeaveOff('/test/continuity', 'agent-A', c.activeWorkspace.id);
    expect(summary.unblockedReadyTasks).toHaveLength(0);
    expect(summary.staleTasks.map((s) => s.task.id)).toContain(forgotten.id);
  });

  it('does not auto-claim stale work after completing a task', async () => {
    const t = task('Current');
    const forgotten = task('Old idea');
    age(forgotten.id, 20);
    c.claimService.claimTask(t.id, 'agent-A', 's1');
    const res = await call('moo_complete_task', { taskId: t.id, agentId: 'agent-A', evidence: { outputSnippet: 'ok' }, autoClaimNext: true });
    expect(res.success).toBe(true);
    expect(res.nextTask).toBeNull();
    expect(res.hint).toContain('stale');
    expect(c.taskRepo.findById(forgotten.id)?.status).toBe('todo');
  });

  it('focuses on a real goal rather than Ad-hoc work', () => {
    const ws = c.activeWorkspace.id;
    const real = c.goalService.createGoal('Mobile redesign', 'p', '/test/continuity', 10, undefined, ws);
    task('Screen A', { goalId: real.id });
    const adhoc = c.goalService.getOrCreateAdhocGoal(ws);
    const quick = task('Quick fix', { goalId: adhoc.id });
    c.db.prepare(`UPDATE tasks SET interrupted_from = 'gone-agent' WHERE id = ?`).run(quick.id);

    const summary = c.sessionService.whereDidILeaveOff('/test/continuity', 'agent-A', ws);
    expect(summary.focusGoal?.id).toBe(real.id);
  });
});
