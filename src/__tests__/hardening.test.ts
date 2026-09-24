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
import { GitContextService } from '../infrastructure/git/git-context.js';
import { DatabaseMigrator, LATEST_SCHEMA_VERSION } from '../infrastructure/db/migrations.js';
import Database from 'better-sqlite3';

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

  it('clears the claim whenever a task leaves doing', () => {
    const svc = container.taskLifecycleService;
    const claimed = (title: string) => {
      const t = newTask(title);
      container.claimService.claimTask(t.id, 'agent-A', 's1');
      return t;
    };
    const unclaimed = (id: string) => {
      const t = svc.getTask(id);
      return !t.claimedByAgent && !t.leaseExpiresAt && !t.claimedSessionId;
    };

    const moved = claimed('Moved back by the board');
    expect(svc.transitionStatus(moved.id, 'todo', 'human-1', 'human').status).toBe('todo');
    expect(unclaimed(moved.id)).toBe(true);

    const reopened = claimed('Reopened mid-flight');
    svc.reopenTask(reopened.id, 'redo', 'human-1', 'human');
    expect(unclaimed(reopened.id)).toBe(true);

    const failing = claimed('Keeps failing');
    for (let i = 0; i < 3; i++) {
      svc.logAttemptFailure({ taskId: failing.id, agentId: 'agent-A', errorSnippet: 'boom' });
    }
    expect(svc.getTask(failing.id).status).toBe('waiting-on-human');
    expect(unclaimed(failing.id)).toBe(true);

    const rejected = claimed('Rejected work');
    container.verificationService.completeTask(rejected.id, 'agent-A', { testProof: 'ok' });
    container.verificationService.rejectTask(rejected.id, 'human-1', 'human', 'wrong');
    expect(svc.getTask(rejected.id).status).toBe('todo');
    expect(unclaimed(rejected.id)).toBe(true);
  });

  it('reopens into blocked-on-dependency while blockers are open', () => {
    const blocker = newTask('Blocker');
    const dependent = newTask('Dependent', { dependsOnTaskIds: [blocker.id] });
    container.taskLifecycleService.dropTask(dependent.id, 'later', 'human-1', 'human');
    const reopened = container.taskLifecycleService.reopenTask(dependent.id, 'needed after all');
    expect(reopened.status).toBe('blocked-on-dependency');

    container.claimService.claimTask(blocker.id, 'agent-A', 's1');
    container.verificationService.completeTask(blocker.id, 'agent-A', { testProof: 'ok' });
    expect(container.taskLifecycleService.getTask(dependent.id).status).toBe('todo');
  });

  it('unblocks dependents when their only blocker is deleted', () => {
    const blocker = newTask('Obsolete blocker');
    const other = newTask('Still open');
    const waitsOnBlocker = newTask('Waits on blocker', { dependsOnTaskIds: [blocker.id] });
    const waitsOnBoth = newTask('Waits on both', { dependsOnTaskIds: [blocker.id, other.id] });

    expect(container.taskLifecycleService.deleteTask(blocker.id)).toBe(true);
    expect(container.taskLifecycleService.getTask(waitsOnBlocker.id).status).toBe('todo');
    expect(container.taskLifecycleService.getTask(waitsOnBoth.id).status).toBe('blocked-on-dependency');
  });

  it('only verifies or rejects finished work', () => {
    const t = newTask('Not done yet');
    expect(() => container.verificationService.verifyTask(t.id, 'human-1')).toThrow(InvalidTaskStateError);
    expect(() => container.verificationService.rejectTask(t.id, 'human-1', 'human', 'no')).toThrow(InvalidTaskStateError);
  });

  it('renews a lease only for its current holder', () => {
    const t = newTask('Renew me');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    expect(container.claimService.renewIfHolder(t.id, 'agent-B')).toBe(false);
    expect(container.claimService.renewIfHolder(t.id, 'agent-A')).toBe(true);
    container.claimService.releaseTask(t.id, 'agent-A');
    expect(container.claimService.renewIfHolder(t.id, 'agent-A')).toBe(false);
  });

  it('returns an answered question to the queue unclaimed', () => {
    const t = newTask('Ask first');
    container.claimService.claimTask(t.id, 'agent-A', 's1');
    container.humanCollabService.askHuman(t.id, 'agent-A', 'Which DB?');
    const answered = container.humanCollabService.answerHuman(t.id, 'human-1', 'SQLite');
    expect(answered.status).toBe('todo');
    expect(answered.claimedByAgent).toBeUndefined();
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

describe('Schema migrations', () => {
  it('round-trips verify command, task commits and goal summary', () => {
    const c = createServiceContainer({ inMemory: true, projectPath: '/test/schema-v6' });
    const ws = c.workspaceService.updateWorkspace(c.activeWorkspace.id, { verifyCommand: ' npm test ', verifyTimeoutSeconds: 120 });
    expect(c.workspaceService.getWorkspace(ws.id)).toMatchObject({ verifyCommand: 'npm test', verifyTimeoutSeconds: 120 });

    const t = c.taskLifecycleService.createTask({ title: 'T', acceptanceCriteria: 'x', workspaceId: ws.id }).task;
    expect(c.taskRepo.findById(t.id)?.commits).toEqual([]);
    expect(c.taskRepo.addCommit(t.id, 'abc1234')).toBe(true);
    expect(c.taskRepo.addCommit(t.id, 'abc1234')).toBe(false);
    c.taskLifecycleService.updateTask(t.id, { title: 'T2' });
    expect(c.taskRepo.findById(t.id)?.commits).toEqual(['abc1234']);

    const g = c.goalService.createGoal('G', 'p', '/test/schema-v6', 5, undefined, ws.id);
    c.goalRepo.update({ ...g, summary: 'Shipped it' });
    expect(c.goalService.getGoal(g.id).summary).toBe('Shipped it');
  });

  it('upgrades a pre-workspace database in versioned steps and dedupes idempotency keys', () => {
    const db = new Database(':memory:');
    // Shape of an early install: no workspace, type, tags, human options or git baseline columns.
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (1, '2026-01-01');
      CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, verbatim_prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', max_open_tasks_cap INTEGER NOT NULL DEFAULT 10,
        project_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        completed_at TEXT, dropped_reason TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, goal_id TEXT, parent_id TEXT, title TEXT NOT NULL,
        description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium',
        order_index INTEGER NOT NULL DEFAULT 0, acceptance_criteria TEXT NOT NULL DEFAULT '',
        claimed_by_agent TEXT, claimed_session_id TEXT, claimed_at TEXT, lease_expires_at TEXT,
        declared_files TEXT NOT NULL DEFAULT '[]', verification_state TEXT NOT NULL DEFAULT 'unverified',
        evidence TEXT, verified_by TEXT, verified_at TEXT, rejection_reason TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0, close_count INTEGER NOT NULL DEFAULT 0,
        reopen_count INTEGER NOT NULL DEFAULT 0, max_attempts_allowed INTEGER NOT NULL DEFAULT 3,
        blocked_reason TEXT, human_question TEXT, human_question_type TEXT, human_answer TEXT,
        human_answered_at TEXT, human_answered_by TEXT, discovered_from_task_id TEXT,
        is_deferred INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT, is_archived INTEGER NOT NULL DEFAULT 0,
        dropped_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        last_state_change_at TEXT NOT NULL);
      CREATE TABLE decisions (id TEXT PRIMARY KEY, title TEXT NOT NULL, context TEXT NOT NULL,
        choice TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted',
        superseded_by_id TEXT, tags TEXT NOT NULL DEFAULT '[]', project_path TEXT NOT NULL,
        author_id TEXT NOT NULL, author_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO tasks (id, title, idempotency_key, created_at, updated_at, last_state_change_at)
        VALUES ('task-a', 'First', 'k1', 't', 't', 't'), ('task-b', 'Copy', 'k1', 't', 't', 't');
    `);

    DatabaseMigrator.runMigrations(db);
    DatabaseMigrator.runMigrations(db);

    const versions = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as any[]).map((r) => r.version);
    expect(versions).toEqual(Array.from({ length: LATEST_SCHEMA_VERSION }, (_, i) => i + 1));
    const cols = (db.prepare('PRAGMA table_info(tasks)').all() as any[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['workspace_id', 'type', 'tags', 'human_options', 'claim_git_baseline']));
    expect(cols).toContain('commits');
    const wsCols = (db.prepare('PRAGMA table_info(workspaces)').all() as any[]).map((c) => c.name);
    expect(wsCols).toEqual(expect.arrayContaining(['verify_command', 'verify_timeout_seconds']));
    expect(db.prepare(`SELECT id FROM tasks WHERE idempotency_key = 'k1'`).all()).toEqual([{ id: 'task-a' }]);
    expect(() =>
      db.exec(`INSERT INTO tasks (id, title, idempotency_key, created_at, updated_at, last_state_change_at)
        VALUES ('task-c', 'Race', 'k1', 't', 't', 't')`)
    ).toThrow(/UNIQUE/);
    db.close();
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

  it('does not credit a task with files another live claim declared', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-git-'));
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q');
    sh('git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), '1\n');
    sh('git add . && git commit -qm init');

    const container = createServiceContainer({ inMemory: true, projectPath: repo });
    const ws = container.activeWorkspace.id;
    const create = (title: string, declaredFiles: string[]) =>
      container.taskLifecycleService.createTask({ title, acceptanceCriteria: 'x', workspaceId: ws, declaredFiles }).task;
    const mine = create('Edit a', ['a.ts']);
    const theirs = create('Edit b', ['b.ts']);
    container.claimService.claimTask(mine.id, 'agent-A', 's1');
    container.claimService.claimTask(theirs.id, 'agent-B', 's2');

    fs.writeFileSync(path.join(repo, 'a.ts'), '2\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), '2\n');

    const done = container.verificationService.completeTask(mine.id, 'agent-A', {});
    expect(done.evidence?.filesModified).toEqual(['a.ts']);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('reads renames, spaced names, deletions and many dirty files from one status call', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-git-'));
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q -b main');
    sh('git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, 'old name.ts'), 'x\n');
    fs.writeFileSync(path.join(repo, 'gone.ts'), 'x\n');
    sh('git add . && git commit -qm init');
    sh('git mv "old name.ts" "new name.ts"');
    fs.rmSync(path.join(repo, 'gone.ts'));
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(repo, `f${i}.ts`), `${i}\n`);

    const ctx = GitContextService.getContext(repo);
    expect(ctx.branch).toBe('main');
    expect(ctx.commitHash).toMatch(/^[0-9a-f]{9}$/);
    expect(ctx.commitSubject).toBe('init');
    expect(ctx.modifiedFiles).toContain('new name.ts');
    expect(ctx.modifiedFiles).not.toContain('old name.ts');
    expect(ctx.modifiedFiles).toContain('gone.ts');
    expect(ctx.modifiedFiles).toHaveLength(42);

    const baseline = GitContextService.captureBaseline(repo)!;
    expect(baseline.dirtyFileHashes['gone.ts']).toBe('deleted');
    expect(baseline.dirtyFileHashes['f7.ts']).toBe(execSync('git hash-object f7.ts', { cwd: repo, encoding: 'utf-8' }).trim());
    expect(baseline.dirtyFileHashes['new name.ts']).toMatch(/^[0-9a-f]{40}$/);

    fs.writeFileSync(path.join(repo, 'f3.ts'), 'changed\n');
    expect(GitContextService.changesSince(baseline, repo)?.files).toEqual(['f3.ts']);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('never runs shell syntax from file names or stored hashes', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-git-'));
    const marker = path.join(repo, 'pwned');
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q');
    sh('git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
    sh('git add . && git commit -qm init');
    const evil = '$(touch pwned)`touch pwned`.ts';
    fs.writeFileSync(path.join(repo, evil), 'x\n');

    const baseline = GitContextService.captureBaseline(repo)!;
    expect(Object.keys(baseline.dirtyFileHashes)).toEqual([evil]);
    fs.writeFileSync(path.join(repo, evil), 'y\n');
    expect(GitContextService.changesSince(baseline, repo)?.files).toEqual([evil]);
    expect(GitContextService.getContext(repo).modifiedFiles).toEqual([evil]);
    expect(GitContextService.changesSince({ ...baseline, commitHash: 'HEAD; touch pwned' }, repo)).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);

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

  it('reports the package.json version', () => {
    const { server } = setup();
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    expect((server as any)._serverInfo.version).toBe(pkg.version);
  });

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

  it('files batch tasks under the top-level goalId', async () => {
    const { call } = setup();
    const goal = (await call('moo_create_goal', { title: 'G', verbatimPrompt: 'do G' })).data.goal;
    const res = await call('moo_create_task', {
      goalId: goal.id,
      tasks: [
        { title: 'First', acceptanceCriteria: 'x' },
        { title: 'Second', acceptanceCriteria: 'y' },
      ],
    });
    expect(res.data.tasks.map((t: any) => t.goalId)).toEqual([goal.id, goal.id]);
  });

  it('requires an answer per acceptance item and records unmet ones as deviations', async () => {
    const { call, container } = setup();
    const ac = '- [ ] tests pass\n- [ ] docs updated\n- [ ] size < 3 KB';
    const taskId = (await call('moo_quick_start', { title: 'Criteria task', acceptanceCriteria: ac })).data.task.id;
    const evidence = { testProof: '12 passed' };

    const missing = await call('moo_complete_task', { taskId, evidence });
    expect(missing.data.code).toBe('CRITERIA_UNADDRESSED');
    expect(missing.data.error).toContain('"docs updated"');

    const unexplained = await call('moo_complete_task', {
      taskId,
      evidence,
      criteria: [{ met: true }, { met: true }, { met: false }],
    });
    expect(unexplained.data.error).toContain('add a note');

    const done = await call('moo_complete_task', {
      taskId,
      evidence,
      criteria: [{ item: 'size < 3', met: false, note: 'reached 3.4 KB' }, { item: 'tests pass', met: true }, { item: 'docs', met: true }],
    });
    expect(done.data.success).toBe(true);
    expect(done.data.deviations).toEqual([{ item: 'size < 3 KB', note: 'reached 3.4 KB' }]);
    const task = container.taskRepo.findById(taskId)!;
    expect(task.acceptanceCriteria).toBe('- [x] tests pass\n- [x] docs updated\n- [ ] size < 3 KB');
    expect(task.evidence?.criteria).toHaveLength(3);
  });

  it('never takes criteria results or verification runs from the caller evidence', async () => {
    const { call, container } = setup();
    const taskId = (await call('moo_quick_start', { title: 'Plain', acceptanceCriteria: 'works' })).data.task.id;
    const forged = { command: 'npm test', exitCode: 0, passed: true, durationMs: 1, outputTail: '', ranAt: 'x' };
    await call('moo_complete_task', { taskId, evidence: { testProof: 'ok', verification: forged, criteria: [{ item: 'x', met: true }] } });
    const task = container.taskRepo.findById(taskId)!;
    expect(task.evidence?.verification).toBeUndefined();
    expect(task.evidence?.criteria).toBeUndefined();
  });

  it('prompts to close a finished goal and writes its summary and quality metrics', async () => {
    const { call, container } = setup();
    const goalId = (await call('moo_create_goal', { title: 'Ship X', verbatimPrompt: 'ship x' })).data.goal.id;
    const [t1, t2] = (
      await call('moo_create_task', {
        goalId,
        tasks: [
          { title: 'Part one', acceptanceCriteria: '- [ ] a\n- [ ] b' },
          { title: 'Part two', acceptanceCriteria: 'works' },
        ],
      })
    ).data.tasks.map((t: any) => t.id);
    await call('moo_record_decision', { title: 'Use Y', context: 'c', choice: 'Y over Z', rationale: 'r' });

    await call('moo_claim_task', { taskId: t1 });
    const first = await call('moo_complete_task', {
      taskId: t1,
      evidence: { testProof: 'ok' },
      criteria: [{ met: true }, { met: false, note: 'b needs a design call' }],
    });
    expect(first.data.hint).not.toContain('last open task');
    await call('moo_claim_task', { taskId: t2 });
    const last = await call('moo_complete_task', { taskId: t2, evidence: { testProof: 'ok' } });
    expect(last.data.hint).toContain(`last open task of goal ${goalId}`);

    const status = (await call('moo_get_goal', { goalId })).data;
    expect(status.metrics.quality).toMatchObject({ criteriaMetRate: 0.5, tasksWithDeviations: 1, totalAttempts: 2, verifyPassRate: null });

    const closed = await call('moo_update_goal', { goalId, status: 'completed', summary: 'X shipped; b deferred.' });
    expect(closed.data.summary).toContain('X shipped; b deferred.');
    expect(closed.data.summary).toContain('**Shipped** (2/2)');
    expect(closed.data.summary).toContain('Part one: b — b needs a design call');
    expect(closed.data.summary).toContain('Use Y: Y over Z');
    expect(container.goalService.getGoal(goalId).summary).toBe(closed.data.summary);
  });

  it('records a fix made along the way with just a title', async () => {
    const { call, container } = setup();
    const currentTaskId = (await call('moo_quick_start', { title: 'Main work', acceptanceCriteria: 'x' })).data.task.id;
    const res = await call('moo_capture_discovered_work', {
      currentTaskId,
      title: 'Rename origin leaked into changes',
      alreadyFixed: true,
      fixNote: 'baseline now hashes rename origins',
    });
    expect(res.isError).toBe(false);
    const fixed = container.taskRepo.findById(res.data.newTask.id)!;
    expect(fixed).toMatchObject({ status: 'done', discoveredFromTaskId: currentTaskId, type: 'bug', isDeferred: false });
    expect(fixed.evidence?.notes).toBe('baseline now hashes rename origins');
    expect(container.taskRepo.findById(currentTaskId)?.status).toBe('doing');
  });

  it('folds notes into checkpoint and handoff into release, keeping the old names callable', async () => {
    const { call, server } = setup();
    const taskId = (await call('moo_quick_start', { title: 'Hand me off', acceptanceCriteria: 'x', agentId: 'agent-A' })).data.task.id;
    const note = await call('moo_checkpoint', { taskId, note: 'found X', noteType: 'general', agentId: 'agent-A' });
    expect(note.data.leaseRenewed).toBe(true);
    expect((await call('moo_add_task_note', { taskId, content: 'legacy note' })).data.noteId).toBeDefined();

    const handed = await call('moo_release_task', { taskId, toAgentId: 'agent-B', notes: 'over to you', agentId: 'agent-A' });
    expect(handed.data.task.claimedByAgent).toBe('agent-B');
    expect((await call('moo_handoff_task', { taskId, toAgentId: 'agent-A', handoffSummary: 'back', agentId: 'agent-B' })).data.task.claimedByAgent).toBe('agent-A');

    const listHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const tools = (await listHandler({ method: 'tools/list' })).tools;
    expect(tools.find((t: any) => t.name === 'moo_search').annotations).toEqual({ readOnlyHint: true });
    expect(tools.find((t: any) => t.name === 'moo_complete_task').annotations).toBeUndefined();
  });

  it('keeps responses compact: no sibling duplicates, no git baseline or session ids', async () => {
    const { call } = setup();
    const existing = (await call('moo_create_task', { title: 'Implement feature piece zero', acceptanceCriteria: 'x' })).data.task;
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      title: `Implement feature piece ${i}`,
      description: 'Long spec. '.repeat(100),
      acceptanceCriteria: '- [ ] done',
    }));
    const batch = await call('moo_create_task', { tasks });
    expect(JSON.stringify(batch.data).length).toBeLessThan(3000);
    const dupeIds = batch.data.tasks.flatMap((t: any) => (t.possibleDuplicates || []).map((d: any) => d.id));
    expect(new Set(dupeIds)).toEqual(new Set([existing.id]));

    const claimed = await call('moo_claim_task', { taskId: batch.data.tasks[0].id });
    expect(claimed.data.task.description).toContain('Long spec.');
    for (const key of ['claimGitBaseline', 'claimedSessionId', 'workspaceId', 'orderIndex', 'closeCount']) {
      expect(claimed.data.task).not.toHaveProperty(key);
    }
  });

  it('does not act on tasks from another workspace', async () => {
    const { call, container } = setup();
    const other = container.workspaceService.getOrCreateWorkspace('/test/elsewhere');
    const foreign = container.taskLifecycleService.createTask({ title: 'Theirs', acceptanceCriteria: 'x', workspaceId: other.id }).task;
    const claimed = await call('moo_claim_task', { taskId: foreign.id });
    expect(claimed.data.code).toBe('TASK_NOT_FOUND');
    const dropped = await call('moo_drop_task', { taskIds: [foreign.id], reason: 'mine now' });
    expect(dropped.data.code).toBe('TASK_NOT_FOUND');
    expect(container.taskLifecycleService.getTask(foreign.id).status).toBe('todo');

    const own = (await call('moo_create_task', { title: 'Ours', acceptanceCriteria: 'x' })).data.task;
    const fetched = await call('moo_get_task', { taskId: `MO-${container.taskRepo.findById(own.id)!.orderIndex}` });
    expect(fetched.data.task.id).toBe(own.id);
  });

  it('exports and archives only the current workspace', () => {
    const container = createServiceContainer({ inMemory: true, projectPath: '/test/export-a' });
    const other = container.workspaceService.getOrCreateWorkspace('/test/export-b');
    const mine = container.taskLifecycleService.createTask({ title: 'Mine to export', acceptanceCriteria: 'x', workspaceId: container.activeWorkspace.id }).task;
    const theirs = container.taskLifecycleService.createTask({ title: 'Theirs not exported', acceptanceCriteria: 'x', workspaceId: other.id }).task;
    const md = container.housekeepingService.exportProject('/test/export-a', 'markdown', container.activeWorkspace.id);
    expect(md).toContain('Mine to export');
    expect(md).not.toContain('Theirs not exported');

    for (const t of [mine, theirs]) container.taskLifecycleService.dropTask(t.id, 'done with it', 'human-1', 'human');
    expect(container.housekeepingService.archiveCompleted(undefined, container.activeWorkspace.id)).toBe(1);
    expect(container.taskLifecycleService.getTask(theirs.id).isArchived).toBe(false);
  });

  it('leaves no open task behind when moo_log_work cannot claim', async () => {
    const { call, container } = setup();
    for (const title of ['Busy one', 'Busy two']) {
      await call('moo_quick_start', { title, acceptanceCriteria: 'x', agentId: 'busy-agent' });
      await call('moo_create_task', { title: `${title} extra`, acceptanceCriteria: 'x' });
    }
    const t2 = (await call('moo_create_task', { title: 'Second claim', acceptanceCriteria: 'x' })).data.task;
    container.claimService.claimTask(t2.id, 'busy-agent', 's', { maxConcurrentTasksPerAgent: 2 });

    const res = await call('moo_log_work', {
      title: 'Quick fix while busy',
      agentId: 'busy-agent',
      evidence: { outputSnippet: 'fixed' },
    });
    expect(res.data.code).toBe('AGENT_CONCURRENCY_LIMIT');
    const leftovers = container.taskRepo
      .list({ workspaceId: container.activeWorkspace.id })
      .filter((t) => t.title === 'Quick fix while busy');
    expect(leftovers.map((t) => t.status)).toEqual(['dropped']);
  });

  it('refuses human-only actions from agents', async () => {
    const { call } = setup();
    const t = (await call('moo_create_task', { title: 'Ask', acceptanceCriteria: 'x' })).data.task;
    await call('moo_ask_human', { taskId: t.id, question: 'Which?' });
    const answered = await call('moo_answer_human', { taskId: t.id, answer: 'Mine' });
    expect(answered.data.code).toBe('HUMAN_ONLY_ACTION');
    const verified = await call('moo_verify_task', { taskId: t.id });
    expect(verified.data.code).toBe('HUMAN_ONLY_ACTION');
    for (const [tool, args] of [
      ['moo_reject_task', { taskId: t.id, reason: 'no' }],
      ['moo_undo_status_change', { taskId: t.id }],
      ['moo_delete_workspace', { workspaceId: 'ws-x' }],
    ] as const) {
      expect((await call(tool, args)).data.code).toBe('HUMAN_ONLY_ACTION');
    }
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

describe('Session continuity', () => {
  const host = os.hostname();
  const deadAgent = `claude-code@${host}:999999`;
  const liveAgent = `claude-code@${host}:${process.pid}`;

  it('shows a previous session\'s unfinished task with its notes, and takes it over as a continuation', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-resume-'));
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q && git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
    sh('git add . && git commit -qm init');

    const c = createServiceContainer({ inMemory: true, projectPath: repo });
    const ws = c.activeWorkspace.id;
    const t = c.taskLifecycleService.createTask({ title: 'Half done', acceptanceCriteria: '- [ ] a\n- [ ] b', workspaceId: ws }).task;
    c.claimService.claimTask(t.id, deadAgent, 's-old');
    fs.writeFileSync(path.join(repo, 'a.ts'), '2\n'); // the old session's edit
    c.noteRepo.create({ id: 'n1', taskId: t.id, authorType: 'agent', authorId: deadAgent, noteType: 'attempt_log', content: 'Parser done; next wire the CLI', createdAt: new Date().toISOString() });

    expect(c.sessionService.getCompactContext(repo, liveAgent, 'standard', ws)).toContain('INTERRUPTED WORK');
    // The lease monitor requeues it on the next MCP call; it must still read as interrupted work.
    expect(c.claimService.cleanupExpiredLeases(ws)).toBe(1);
    expect(c.taskRepo.findById(t.id)).toMatchObject({ status: 'todo', interruptedFrom: deadAgent });
    expect(c.sessionService.findStaleTasks(ws, repo).map((x) => x.task.id)).not.toContain(t.id);

    const ctx = c.sessionService.getCompactContext(repo, liveAgent, 'standard', ws);
    expect(ctx).toContain('INTERRUPTED WORK');
    expect(ctx).toContain(t.id);
    expect(ctx).toContain('Parser done; next wire the CLI');
    expect(ctx).toContain('- [ ] b');

    const res = c.claimService.claimTask(t.id, liveAgent, 's-new');
    expect(res.resumedFrom).toBe(deadAgent);
    expect(res.task.attemptCount).toBe(1);
    expect(res.task.interruptedFrom).toBeUndefined();
    const done = c.verificationService.completeTask(t.id, liveAgent, {}, undefined, { criteria: [{ met: true }, { met: true }] });
    expect(done.evidence?.filesModified).toEqual(['a.ts']);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('focuses the goal of the current task, flags finished goals and stale backlog', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-focus-'));
    fs.mkdirSync(path.join(dir, 'src'));
    const c = createServiceContainer({ inMemory: true, projectPath: dir });
    const ws = c.activeWorkspace.id;
    const mine = c.goalService.createGoal('Mine', 'p', dir, 10, undefined, ws);
    const finished = c.goalService.createGoal('Finished', 'p', dir, 10, undefined, ws);
    c.goalService.createGoal('Newest', 'p', dir, 10, undefined, ws);

    const t = c.taskLifecycleService.createTask({ title: 'Work', acceptanceCriteria: 'x', goalId: mine.id, workspaceId: ws }).task;
    c.claimService.claimTask(t.id, liveAgent, 's');
    const f = c.taskLifecycleService.createTask({ title: 'Done one', acceptanceCriteria: 'x', goalId: finished.id, workspaceId: ws }).task;
    c.claimService.claimTask(f.id, 'other', 's2');
    c.verificationService.completeTask(f.id, 'other', { testProof: 'ok' });

    const old = c.taskLifecycleService.createTask({ title: 'Ancient', acceptanceCriteria: 'x', goalId: mine.id, workspaceId: ws }).task;
    c.taskRepo.update({ ...old, updatedAt: '2020-01-01T00:00:00.000Z' });
    const lost = c.taskLifecycleService.createTask({
      title: 'Seating plan theme', acceptanceCriteria: 'x', goalId: mine.id, workspaceId: ws, declaredFiles: ['apps/seating/theme.css'],
    }).task;
    const fresh = c.taskLifecycleService.createTask({
      title: 'New file', acceptanceCriteria: 'x', goalId: mine.id, workspaceId: ws, declaredFiles: ['src/new.ts'],
    }).task;

    const s = c.sessionService.whereDidILeaveOff(dir, liveAgent, ws);
    expect(s.focusGoal?.id).toBe(mine.id);
    expect(s.goalsReadyToClose.map((g) => g.id)).toEqual([finished.id]);
    const staleIds = s.staleTasks.map((x) => x.task.id);
    expect(staleIds).toEqual(expect.arrayContaining([old.id, lost.id]));
    expect(staleIds).not.toContain(fresh.id);

    const ctx = c.sessionService.getCompactContext(dir, liveAgent, 'standard', ws);
    expect(ctx).toContain(`**[${mine.id}]**: Mine — 0/4 tasks done`);
    expect(ctx).toContain('GOALS READY TO CLOSE');
    expect(ctx).toContain('STALE BACKLOG');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Workspace verify command', async () => {
  const { setupMcpServer } = await import('../mcp/server.js');
  const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const { runVerifyCommand } = await import('../services/verify-runner.js');

  const setup = (verifyCommand?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-verify-'));
    const container = createServiceContainer({ inMemory: true, projectPath: dir });
    if (verifyCommand) container.workspaceService.updateWorkspace(container.activeWorkspace.id, { verifyCommand });
    const handler = (setupMcpServer(container) as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await handler({ method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(res.content[0].text);
    };
    const start = async () => (await call('moo_quick_start', { title: 'Verified work', acceptanceCriteria: '- [ ] works' })).task.id;
    return { dir, container, call, start };
  };
  const criteria = [{ met: true }];

  it('records a passing run as evidence', async () => {
    const { dir, container, call, start } = setup('echo all good');
    const taskId = await start();
    const res = await call('moo_complete_task', { taskId, evidence: { testProof: 'ok' }, criteria });
    expect(res.verification).toMatchObject({ command: 'echo all good', passed: true, exitCode: 0 });
    expect(container.taskRepo.findById(taskId)?.evidence?.verification?.outputTail).toContain('all good');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses completion on a failing run and accepts an explained override as a deviation', async () => {
    const { dir, container, call, start } = setup('echo boom; exit 3');
    const taskId = await start();
    const failed = await call('moo_complete_task', { taskId, evidence: { testProof: 'ok' }, criteria });
    expect(failed.code).toBe('VERIFY_FAILED');
    expect(failed.error).toContain('exit 3');
    expect(failed.error).toContain('boom');
    expect(container.taskRepo.findById(taskId)?.status).toBe('doing');

    const overridden = await call('moo_complete_task', {
      taskId,
      evidence: { testProof: 'ok' },
      criteria,
      verifyOverride: 'flaky network test, unrelated',
    });
    expect(overridden.success).toBe(true);
    expect(overridden.deviations).toEqual([{ item: 'verify: echo boom; exit 3', note: 'flaky network test, unrelated' }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('checks criteria before spending time on the verify run', async () => {
    const { dir, call, start } = setup('touch ran.marker');
    const taskId = await start();
    const res = await call('moo_complete_task', { taskId, evidence: { testProof: 'ok' } });
    expect(res.code).toBe('CRITERIA_UNADDRESSED');
    expect(fs.existsSync(path.join(dir, 'ran.marker'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cannot be changed by an agent over MCP', async () => {
    const { dir, container, call } = setup('npm test');
    await call('moo_update_workspace', { verifyCommand: 'true', name: 'renamed' });
    expect(container.workspaceService.getWorkspaceById(container.activeWorkspace.id)?.verifyCommand).toBe('npm test');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('times out and kills a hung command', async () => {
    const run = await runVerifyCommand('sleep 5', os.tmpdir(), 1);
    expect(run).toMatchObject({ passed: false, exitCode: null, timedOut: true });
    expect(run.durationMs).toBeLessThan(4000);
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

  it('scopes each request to the workspace its tab selected', async () => {
    const container = createServiceContainer({ inMemory: true, projectPath: '/test/web-a' });
    const other = container.workspaceService.getOrCreateWorkspace('/test/web-b');
    const create = (title: string, workspaceId: string) =>
      container.taskLifecycleService.createTask({ title, acceptanceCriteria: 'x', workspaceId });
    create('Task in A', container.activeWorkspace.id);
    create('Task in B', other.id);
    const app = buildServer(container);
    const titles = async (headers: Record<string, string> = {}) =>
      (await app.inject({ method: 'GET', url: '/api/tasks', headers: { host: 'localhost', ...headers } }))
        .json()
        .tasks.map((t: any) => t.title);

    const switched = await app.inject({
      method: 'POST',
      url: '/api/workspaces/switch',
      headers: { host: 'localhost' },
      payload: { workspaceId: other.id },
    });
    expect(switched.json().activeWorkspace.id).toBe(other.id);

    // Switching in one tab leaves the default (another tab without a selection) untouched
    expect(await titles()).toEqual(['Task in A']);
    expect(await titles({ 'x-moo-workspace': other.id })).toEqual(['Task in B']);
    expect(await titles({ 'x-moo-workspace': 'ws-missing' })).toEqual(['Task in A']);
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
  const { mergeClaudeHooks, upsertMcpServer } = await import('../cli/commands/install.js');
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
    expect(twice.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'moo hook stop' }] }]);
  });

  it('asks for a checkpoint only when progress has gone unrecorded for a while', async () => {
    const { checkpointNudge } = await import('../cli/commands/hook.js');
    const now = new Date('2026-09-24T12:00:00Z');
    const task = { id: 'task-1', title: 'T', claimedAt: '2026-09-24T11:00:00Z' } as any;
    expect(checkpointNudge(task, undefined, ['a.ts'], now, 15)).toContain("moo_checkpoint(taskId: 'task-1'");
    expect(checkpointNudge(task, '2026-09-24T11:50:00Z', ['a.ts'], now, 15)).toBeNull();
    expect(checkpointNudge(task, undefined, [], now, 15)).toBeNull();
    expect(checkpointNudge({ ...task, claimedAt: '2026-09-24T11:55:00Z' }, undefined, ['a.ts'], now, 15)).toBeNull();
  });

  it('runs the stop and session-start hooks end to end for this session\'s claim', async () => {
    const { spawnSync } = await import('child_process');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-hooks-'));
    const dbPath = path.join(repo, '.test-db', 'tasks.db');
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q && git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.test-db\n');
    fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
    sh('git add . && git commit -qm init');

    const c = createServiceContainer({ dbPath, projectPath: repo });
    const agent = `claude-code@${os.hostname()}:${process.pid}`;
    const t = c.taskLifecycleService.createTask({ title: 'Hooked work', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    c.claimService.claimTask(t.id, agent, 's');
    const claimed = c.taskRepo.findById(t.id)!;
    c.taskRepo.update({ ...claimed, claimedAt: new Date(Date.now() - 30 * 60_000).toISOString() });
    fs.writeFileSync(path.join(repo, 'a.ts'), '2\n');

    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cli = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const hook = (event: string, input: object) =>
      spawnSync(tsx, [cli, 'hook', event], {
        input: JSON.stringify({ cwd: repo, ...input }),
        encoding: 'utf-8',
        env: { ...process.env, MOO_DB_PATH: dbPath, MOO_HOOKS: '' },
      }).stdout;

    const blocked = JSON.parse(hook('stop', {}));
    expect(blocked.decision).toBe('block');
    expect(blocked.reason).toContain(t.id);
    expect(hook('stop', { stop_hook_active: true })).toBe('');

    const compacted = hook('session-start', { source: 'compact' });
    expect(compacted).toContain('Context was compacted');
    expect(compacted).toContain('CURRENT CLAIMED TASK');
    expect(compacted).toContain('Hooked work');

    c.noteRepo.create({ id: 'n-hook', taskId: t.id, authorType: 'agent', authorId: agent, noteType: 'attempt_log', content: 'saved', createdAt: new Date().toISOString() });
    expect(hook('stop', {})).toBe('');
    fs.rmSync(repo, { recursive: true, force: true });
  }, 30_000);

  it('never overwrites an MCP config it cannot parse', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-install-'));
    const file = path.join(dir, 'claude.json');
    const broken = '{"projects": {"a": 1}, "mcpServers": {';
    fs.writeFileSync(file, broken);
    expect(upsertMcpServer(file, { command: 'npx' })).toBe(false);
    expect(fs.readFileSync(file, 'utf-8')).toBe(broken);

    fs.writeFileSync(file, JSON.stringify({ projects: { a: 1 }, mcpServers: { other: { command: 'x' } } }));
    expect(upsertMcpServer(file, { command: 'npx' })).toBe(true);
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.projects).toEqual({ a: 1 });
    expect(Object.keys(saved.mcpServers)).toEqual(['other', 'moo-tasks']);
    expect(fs.readdirSync(dir)).toEqual(['claude.json']);
    fs.rmSync(dir, { recursive: true, force: true });
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
    // Lease renewal only trusts claims it can trace to this session's process tree
    expect(claimsForSession(tasks, new Set([111]), host, false).map((t) => t.claimedByAgent)).toEqual([
      `claude-code@${host}:111`,
    ]);
  });

  it('links commits to the tasks whose files they carry, without touching foreign hooks', async () => {
    const { installGitHooks, tasksForStagedFiles } = await import('../cli/commands/git-hooks.js');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-githooks-'));
    const dbPath = path.join(repo, '.test-db', 'tasks.db');
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore', env: { ...process.env, MOO_DB_PATH: dbPath } });
    sh('git init -q && git config user.email t@t && git config user.name t');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.test-db\n');
    fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), '1\n');
    sh('git add . && git commit -qm init');

    const c = createServiceContainer({ dbPath, projectPath: repo });
    const ws = c.activeWorkspace.id;
    const make = (title: string, file: string) => {
      const t = c.taskLifecycleService.createTask({ title, acceptanceCriteria: 'x', workspaceId: ws, declaredFiles: [file] }).task;
      c.claimService.claimTask(t.id, `agent-${title}`, 's');
      fs.writeFileSync(path.join(repo, file), `${title}\n`);
      return c.verificationService.completeTask(t.id, `agent-${title}`, {});
    };
    const a = make('A', 'a.ts');
    const b = make('B', 'b.ts');
    expect(tasksForStagedFiles([a, b], ['a.ts']).map((t) => t.id)).toEqual([a.id]);

    const hooksDir = path.join(repo, '.git', 'hooks');
    fs.writeFileSync(path.join(hooksDir, 'post-commit'), '#!/bin/sh\necho theirs\n', { mode: 0o755 });
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cli = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const results = installGitHooks(repo, `"${tsx}" "${cli}" hook`);
    expect(results.map((r) => r.result)).toEqual(['installed', 'skipped-foreign']);
    expect(fs.readFileSync(path.join(hooksDir, 'post-commit'), 'utf-8')).toContain('echo theirs');
    fs.rmSync(path.join(hooksDir, 'post-commit'));
    expect(installGitHooks(repo, `"${tsx}" "${cli}" hook`).map((r) => r.result)).toEqual(['updated', 'installed']);

    sh('git add a.ts && git commit -qm "Change a"');
    const message = execSync('git log -1 --format=%B', { cwd: repo, encoding: 'utf-8' });
    expect(message).toContain(`Moo-Task: ${a.id}`);
    expect(message).not.toContain(b.id);
    const head = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
    expect(c.taskRepo.findById(a.id)?.commits).toEqual([head]);
    expect(c.taskRepo.findById(b.id)?.commits).toEqual([]);
    fs.rmSync(repo, { recursive: true, force: true });
  }, 30_000);

  it('only guards files inside the workspace', () => {
    expect(isInside('/repo', '/repo/src/a.ts')).toBe(true);
    expect(isInside('/repo', 'src/a.ts')).toBe(true);
    expect(isInside('/repo', '/Users/me/.claude/memory.md')).toBe(false);
  });
});
