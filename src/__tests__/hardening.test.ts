import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { createServiceContainer, ServiceContainer } from '../services/index.js';
import {
  InvalidTaskStateError,
  NotTaskHolderError,
  TaskAlreadyClaimedError,
  TaskNotClaimableError,
} from '../domain/errors.js';
import { formatAgentIdentity, hasLiveLease } from '../domain/lease.js';

describe('Claim, lease and completion invariants', () => {
  let container: ServiceContainer;
  let wsId: string;

  const newTask = (title: string, extra: Record<string, unknown> = {}) =>
    container.taskLifecycleService.createTask({ title, acceptanceCriteria: 'done', workspaceId: wsId, ...extra }).task;

  beforeEach(() => {
    container = createServiceContainer({ inMemory: true, projectPath: '/test/hardening' });
    wsId = container.activeWorkspace.id;
  });

  it('refuses a second agent while the first lease is live', () => {
    const t = newTask('Exclusive work');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(() => container.claimService.claimTask(t.id, 'agent-B', 's2')).toThrow(TaskAlreadyClaimedError);
  });

  it('refuses to claim done or dropped tasks', () => {
    const t = newTask('Finish me');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    container.verificationService.completeTask(t.id, 'agent-A', { testProof: '1 passed' });
    expect(() => container.claimService.claimTask(t.id, 'agent-B', 's2')).toThrow(TaskNotClaimableError);

    const d = newTask('Drop me');
    container.taskLifecycleService.dropTask(d.id, 'not needed', 'human-1', 'human');
    expect(() => container.claimService.claimTask(d.id, 'agent-A', 's1')).toThrow(TaskNotClaimableError);
  });

  it('records the real previous status in history on claim', () => {
    const t = newTask('History');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    const latest = container.statusHistoryRepo.findLatestByTaskId(t.id);
    expect(latest?.fromStatus).toBe('todo');
    expect(latest?.toStatus).toBe('doing');
  });

  it('only lets the holder heartbeat, release or hand off', () => {
    const t = newTask('Owned');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(() => container.claimService.heartbeatTask(t.id, 'agent-B')).toThrow(NotTaskHolderError);
    expect(() => container.claimService.releaseTask(t.id, 'agent-B')).toThrow(NotTaskHolderError);
    expect(() => container.claimService.handoffTask(t.id, 'agent-B', 'agent-C', 'steal', 's3')).toThrow(NotTaskHolderError);

    const handed = container.claimService.handoffTask(t.id, 'agent-A', 'agent-C', 'over to you', 's3');
    expect(handed.claimedByAgent).toBe('agent-C');
  });

  it('refuses to release a task that is not in progress', () => {
    const t = newTask('Not started');
    expect(() => container.claimService.releaseTask(t.id, 'agent-A')).toThrow(InvalidTaskStateError);
  });

  it('treats a claim held by an exited local process as expired', () => {
    const t = newTask('Crashed session');
    // pid 2^22 + 12345 is above the default pid_max on Linux and macOS, so it cannot be alive.
    const deadHolder = formatAgentIdentity('claude-code', 4_206_649);
    container.claimService.claimTask(t.id, deadHolder, 's1');
    expect(hasLiveLease(container.taskLifecycleService.getTask(t.id))).toBe(false);

    const reclaimed = container.claimService.claimTask(t.id, 'agent-B', 's2');
    expect(reclaimed.task.claimedByAgent).toBe('agent-B');
  });

  it('returns expired and dead-holder claims to the queue during cleanup', () => {
    const t = newTask('Stale');
    container.claimService.claimTask(t.id, 'agent-A', 's1', { leaseDurationSeconds: 1 });
    const task = container.taskLifecycleService.getTask(t.id);
    task.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
    container.taskRepo.update(task);

    expect(container.claimService.cleanupExpiredLeases(wsId)).toBe(1);
    const after = container.taskLifecycleService.getTask(t.id);
    expect(after.status).toBe('todo');
    expect(after.claimedByAgent).toBeUndefined();
  });

  it('does not count renewing your own claim as a new attempt', () => {
    const t = newTask('Renew');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    const again = container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(again.attemptCount).toBe(1);
  });

  it('restarts the attempt budget after a human answers an escalation', () => {
    const t = newTask('Loops');
    for (let i = 0; i < 3; i++) {
      container.claimService.claimTask(t.id, 'agent-A', 's1');
      container.claimService.releaseTask(t.id, 'agent-A');
    }
    const escalated = container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(escalated.autoEscalatedToHuman).toBe(true);

    container.humanCollabService.answerHuman(t.id, 'human-1', 'Try the other approach');
    const resumed = container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(resumed.autoEscalatedToHuman).toBe(false);
    expect(resumed.task.status).toBe('doing');
  });

  it('unblocks dependents when their blocker is dropped', () => {
    const blocker = newTask('Blocker');
    const dependent = newTask('Dependent', { dependsOnTaskIds: [blocker.id] });
    expect(dependent.status).toBe('blocked-on-dependency');

    container.taskLifecycleService.dropTask(blocker.id, 'approach abandoned', 'human-1', 'human');
    expect(container.taskLifecycleService.getTask(dependent.id).status).toBe('todo');
  });

  it('does not resolve a missing task-… id to an unrelated task by sequence number', () => {
    newTask('Unrelated');
    expect(container.taskRepo.findById('task-00000001')).toBeNull();
  });

  it('keeps projects apart when searching', () => {
    const other = container.workspaceService.getOrCreateWorkspace('/test/other');
    newTask('Refactor payment gateway');
    container.taskLifecycleService.createTask({
      title: 'Refactor payment gateway elsewhere',
      acceptanceCriteria: 'x',
      workspaceId: other.id,
    });
    const scoped = container.searchService.search('payment', { workspaceId: wsId });
    expect(scoped.results.every((r) => r.task?.workspaceId === wsId)).toBe(true);
    expect(scoped.results.length).toBe(1);
  });
});

describe('Git evidence since claim', () => {
  it('attributes only files changed after the claim and accepts them as proof', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-git-'));
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q');
    sh('git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
    sh('git add . && git commit -qm init');
    // b.ts is already dirty before the claim and stays untouched afterwards
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 2;\n');

    const container = createServiceContainer({ inMemory: true, projectPath: repo });
    const t = container.taskLifecycleService.createTask({
      title: 'Change a',
      acceptanceCriteria: 'a changed',
      workspaceId: container.activeWorkspace.id,
    }).task;
    container.claimService.claimTask(t.id, 'agent-A', 's1');

    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(repo, 'c.ts'), 'export const c = 1;\n');

    const done = container.verificationService.completeTask(t.id, 'agent-A', {});
    expect(done.status).toBe('done');
    expect(done.evidence?.filesModified).toEqual(['a.ts', 'c.ts']);
    expect(done.evidence?.gitContext?.diffSummary).toContain('1 file changed');

    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe('MCP surface: identity, lightweight path and errors', async () => {
  const { setupMcpServer } = await import('../mcp/server.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  const setup = () => {
    const container = createServiceContainer({ inMemory: true, projectPath: '/test/mcp-hardening' });
    const server = setupMcpServer(container);
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await handler({ method: 'tools/call', params: { name, arguments: args } });
      return { isError: Boolean(res.isError), data: JSON.parse(res.content[0].text) };
    };
    return { container, server, call };
  };

  it('lists a consolidated tool surface roughly half the size of the legacy one', async () => {
    const { server } = setup();
    const { LEGACY_TOOL_DEFS } = await import('../mcp/tool-defs-legacy.js');
    const list = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const { tools } = await list({ method: 'tools/list' });
    const size = JSON.stringify(tools).length;
    const legacySize = JSON.stringify(LEGACY_TOOL_DEFS).length;
    expect(tools.length).toBeLessThanOrEqual(28);
    expect(size).toBeLessThan(legacySize * 0.6);
  });

  it('reports missing required arguments instead of "Task undefined not found"', async () => {
    const { call } = setup();
    const res = await call('moo_claim_task', {});
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe('INVALID_ARGUMENTS');
    expect(res.data.error).toContain('taskId');
    expect(res.data.expectedArguments).toBeDefined();
  });

  it('keeps legacy tool names callable', async () => {
    const { call } = setup();
    const a = (await call('moo_create_task', { title: 'A', acceptanceCriteria: 'a' })).data.task;
    const b = (await call('moo_create_task', { title: 'B', acceptanceCriteria: 'b' })).data.task;
    const linked = await call('moo_link_dependencies', { taskId: b.id, dependsOnTaskIds: [a.id] });
    expect(linked.data.dependencies).toEqual([a.id]);
    expect(linked.data.status).toBe('blocked-on-dependency');
  });

  it('refuses human-only actions from agents', async () => {
    const { call } = setup();
    const t = (await call('moo_create_task', { title: 'Ask', acceptanceCriteria: 'x' })).data.task;
    await call('moo_ask_human', { taskId: t.id, question: 'Which?' });
    const answered = await call('moo_answer_human', { taskId: t.id, answer: 'Mine' });
    expect(answered.data.code).toBe('HUMAN_ONLY_ACTION');
    const verified = await call('moo_verify_task', { taskId: t.id });
    expect(verified.data.code).toBe('HUMAN_ONLY_ACTION');
  });

  it('does not let a different identity complete or release a claimed task', async () => {
    const { call } = setup();
    const claimed = await call('moo_quick_start', { title: 'Mine', acceptanceCriteria: 'x', agentId: 'agent-A' });
    expect(claimed.data.success).toBe(true);
    const taskId = claimed.data.task.id;

    const stolen = await call('moo_complete_task', { taskId, evidence: { testProof: 'ok' } });
    expect(stolen.data.code).toBe('NOT_TASK_HOLDER');
    expect(stolen.data.nextTool).toBe('moo_claim_task');
    const released = await call('moo_release_task', { taskId });
    expect(released.data.code).toBe('NOT_TASK_HOLDER');

    const done = await call('moo_complete_task', { taskId, agentId: 'agent-A', evidence: { testProof: '3 passed' } });
    expect(done.data.task.status).toBe('done');
  });

  it('quick_start works without a goal and files the task under the ad-hoc goal', async () => {
    const { call, container } = setup();
    const res = await call('moo_quick_start', { title: 'Tiny fix', acceptanceCriteria: 'fixed' });
    expect(res.data.success).toBe(true);
    const goal = container.goalService.getGoal(res.data.task.goalId);
    expect(goal.title).toBe('Ad-hoc work');
  });

  it('moo_log_work records finished work in one call and cleans up when evidence is missing', async () => {
    const { call, container } = setup();
    const logged = await call('moo_log_work', { title: 'Bump timeout', evidence: { testProof: 'suite green' } });
    expect(logged.data.task.status).toBe('done');

    const rejected = await call('moo_log_work', { title: 'No proof', evidence: {} });
    expect(rejected.data.code).toBe('MISSING_EVIDENCE');
    const leftovers = container.taskRepo.list({ status: 'doing' });
    expect(leftovers).toHaveLength(0);
  });

  it('merges create and batch create, and claims via get_next_task', async () => {
    const { call } = setup();
    const batch = await call('moo_create_task', {
      tasks: [
        { title: 'First', acceptanceCriteria: 'x', priority: 'high' },
        { title: 'Second', acceptanceCriteria: 'y' },
      ],
    });
    expect(batch.data.createdCount).toBe(2);
    const next = await call('moo_get_next_task', { claim: true });
    expect(next.data.success).toBe(true);
    expect(next.data.task.title).toBe('First');
    expect(next.data.task.status).toBe('doing');
  });
});

describe('Web board request guard', async () => {
  const { buildServer } = await import('../server/app.js');

  it('serves health and same-host requests but rejects foreign Host and Origin headers', async () => {
    const container = createServiceContainer({ inMemory: true, projectPath: '/test/web' });
    const app = buildServer(container);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ ok: true, service: 'moo-tasks' });

    const rebinding = await app.inject({ method: 'GET', url: '/api/tasks', headers: { host: 'evil.example:4242' } });
    expect(rebinding.statusCode).toBe(403);

    const crossSite = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/task-x',
      headers: { host: 'localhost:4242', origin: 'https://evil.example' },
    });
    expect(crossSite.statusCode).toBe(403);

    const sameOrigin = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { host: 'localhost:4242', origin: 'http://localhost:4242' },
    });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

describe('moo init managed rules block', async () => {
  const { upsertManagedBlock, MOO_BLOCK_START, MOO_BLOCK_END } = await import('../cli/commands/init.js');

  it('preserves user content, replaces legacy protocol text, and is idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-init-'));
    const file = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(
      file,
      '# My project\n\nKeep this line.\n\n# 🐮 AGENT GUIDELINES & PROTOCOL (Moo Tasks)\nold text\n- so subsequent agents never re-debate established decisions.\n\n## My own section\nAlso keep.\n'
    );

    expect(upsertManagedBlock(file, 'NEW PROTOCOL v1')).toBe('updated');
    let content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('Keep this line.');
    expect(content).toContain('## My own section\nAlso keep.');
    expect(content).not.toContain('old text');
    expect(content).toContain(MOO_BLOCK_START);

    expect(upsertManagedBlock(file, 'NEW PROTOCOL v1')).toBe('unchanged');
    expect(upsertManagedBlock(file, 'NEW PROTOCOL v2')).toBe('updated');
    content = fs.readFileSync(file, 'utf-8');
    expect(content.match(/NEW PROTOCOL/g)).toHaveLength(1);
    expect(content).toContain('v2');
    expect(content.split(MOO_BLOCK_END)).toHaveLength(2);
    expect(content).toContain('Also keep.');

    const plain = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(plain, '# Team notes\n');
    expect(upsertManagedBlock(plain, 'P')).toBe('appended');
    expect(fs.readFileSync(plain, 'utf-8').startsWith('# Team notes\n\n')).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Claude Code hooks', async () => {
  const { mergeClaudeHooks } = await import('../cli/commands/install.js');
  const { claimsForSession, isInside } = await import('../cli/commands/hook.js');

  it('installs hooks idempotently and keeps unrelated hooks', () => {
    const existing = {
      model: 'opus',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter' }] }] },
    };
    const once = mergeClaudeHooks(existing, 'moo hook');
    const twice = mergeClaudeHooks(once, 'moo hook');
    expect(twice).toEqual(once);
    expect(twice.model).toBe('opus');
    expect(twice.hooks.PreToolUse).toHaveLength(2);
    expect(twice.hooks.PreToolUse[0].hooks[0].command).toBe('my-linter');
    expect(twice.hooks.SessionStart[0].hooks[0].command).toBe('moo hook session-start');
    expect(twice.hooks.PostToolUse[0].matcher).toContain('Edit');
  });

  it('attributes claims to the calling session by process ancestry', () => {
    const host = os.hostname();
    const task = (claimedByAgent: string) => ({ claimedByAgent }) as any;
    const tasks = [task(`claude-code@${host}:111`), task(`claude-code@${host}:222`), task('custom-agent')];
    expect(claimsForSession(tasks, new Set([111]), host).map((t) => t.claimedByAgent)).toEqual([
      `claude-code@${host}:111`,
      'custom-agent',
    ]);
    expect(claimsForSession([tasks[1]], new Set([111]), host)).toHaveLength(0);
  });

  it('only guards files inside the workspace', () => {
    expect(isInside('/repo', '/repo/src/a.ts')).toBe(true);
    expect(isInside('/repo', 'src/a.ts')).toBe(true);
    expect(isInside('/repo', '/Users/me/.claude/memory.md')).toBe(false);
  });
});
