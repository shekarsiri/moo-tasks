import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServiceContainer } from '../services/index.js';
import { setupMcpServer } from '../mcp/server.js';
import { DatabaseManager } from '../infrastructure/db/database.js';
import { openWorkspace } from '../cli/commands/hook.js';

const tempDirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MOO_HOME;
});

function gitRepo(): string {
  const repo = tempDir('moo-repo-');
  const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
  sh('git init -q -b main');
  sh('git config user.email t@t && git config user.name t');
  fs.writeFileSync(path.join(repo, 'a.ts'), '1\n');
  sh('git add . && git commit -qm init');
  return repo;
}

const mcpCall = (container: Parameters<typeof setupMcpServer>[0]) => {
  const server = setupMcpServer(container);
  const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await handler({ method: 'tools/call', params: { name, arguments: args } });
    const text = res.content[0].text;
    try {
      return { ...JSON.parse(text), isError: res.isError };
    } catch {
      return { text, isError: res.isError };
    }
  };
};

describe('Project detection', () => {
  it('does not treat the global Moo home as a project marker', () => {
    const home = tempDir('moo-home-');
    fs.mkdirSync(path.join(home, '.moo'));
    fs.mkdirSync(path.join(home, 'notes'));
    process.env.MOO_HOME = path.join(home, '.moo');

    expect(DatabaseManager.detectProject(path.join(home, 'notes'))).toEqual({
      root: path.join(home, 'notes'),
      isProject: false,
      isGit: false,
    });
    // A project's own .moo directory still marks it
    const project = tempDir('moo-local-');
    fs.mkdirSync(path.join(project, '.moo'));
    fs.mkdirSync(path.join(project, 'src'));
    expect(DatabaseManager.detectProject(path.join(project, 'src'))).toMatchObject({ root: project, isProject: true });
  });

  it('registers nothing for a directory that is not a project, and MCP tools say so', async () => {
    const dir = tempDir('moo-plain-');
    const container = createServiceContainer({ inMemory: true, projectPath: dir, register: 'if-project' });
    expect(container.activeWorkspace).toBeUndefined();
    expect(container.workspaceService.listWorkspaces()).toHaveLength(0);

    const call = mcpCall(container);
    const listed = await call('moo_list_tasks');
    expect(listed.isError).toBe(true);
    expect(listed.code).toBe('NO_WORKSPACE');
    expect(listed.recoveryAction).toContain('moo init');

    const resume = await call('moo_session_resume');
    expect(resume.isError).toBeFalsy();
    expect(resume.text).toContain('inactive');
    expect(container.workspaceService.listWorkspaces()).toHaveLength(0);
  });

  it('registers a git checkout from a subdirectory under the repository root', () => {
    const repo = gitRepo();
    fs.mkdirSync(path.join(repo, 'pkg'));
    const container = createServiceContainer({ inMemory: true, projectPath: path.join(repo, 'pkg'), register: 'if-project' });
    expect(container.activeWorkspace?.rootPath).toBe(repo);
    expect(container.projectPath).toBe(repo);
  });
});

describe('Git worktrees', () => {
  it('map to the main repository workspace while git evidence and verify run in the worktree', async () => {
    const repo = gitRepo();
    const wt = path.join(tempDir('moo-wt-'), 'feature');
    execSync(`git worktree add -q -b feature "${wt}"`, { cwd: repo, stdio: 'ignore' });

    const main = createServiceContainer({ inMemory: true, projectPath: repo });
    const mainWs = main.activeWorkspace;
    // Same database, opened from the worktree
    const location = main.workspaceService.resolveLocation(wt, 'never');
    expect(location.workspace?.id).toBe(mainWs.id);
    expect(location.checkoutRoot).toBe(wt);
    expect(location.repoRoot).toBe(repo);

    const fromWt = createServiceContainer({ inMemory: true, projectPath: wt, register: 'if-project' });
    expect(fromWt.activeWorkspace?.rootPath).toBe(repo);
    expect(fromWt.projectPath).toBe(wt);
    expect(fromWt.workspaceService.listWorkspaces()).toHaveLength(1);

    // The verify command must see the worktree's files, not the main checkout's
    fromWt.workspaceService.updateWorkspace(fromWt.activeWorkspace!.id, {
      verifyCommand: `node -e "process.exit(require('fs').existsSync('only-in-wt.txt') ? 0 : 1)"`,
    });
    const call = mcpCall(fromWt);
    const started = await call('moo_quick_start', { title: 'Worktree change', acceptanceCriteria: 'file added', agentId: 'wt-agent' });
    expect(started.success).toBe(true);
    fs.writeFileSync(path.join(wt, 'only-in-wt.txt'), 'x\n');

    const done = await call('moo_complete_task', { taskId: started.task.id, evidence: {}, agentId: 'wt-agent', criteria: [{ met: true }] });
    expect(done.success).toBe(true);
    expect(done.verification.passed).toBe(true);
    expect(done.filesModified).toEqual(['only-in-wt.txt']);
  });

  it('resolves to the main workspace from hooks run inside the worktree, without registering anything', () => {
    const repo = gitRepo();
    const wt = path.join(tempDir('moo-wt-'), 'hooked');
    execSync(`git worktree add -q -b hooked "${wt}"`, { cwd: repo, stdio: 'ignore' });
    process.env.MOO_DB_PATH = path.join(tempDir('moo-db-'), 'tasks.db');
    try {
      const first = openWorkspace(wt);
      expect(first.workspace).toBeNull();
      const ws = createServiceContainer({ projectPath: repo }).activeWorkspace;
      const hooked = openWorkspace(path.join(wt));
      expect(hooked.workspace?.id).toBe(ws.id);
      expect(hooked.location.checkoutRoot).toBe(wt);
    } finally {
      DatabaseManager.close();
      delete process.env.MOO_DB_PATH;
    }
  });

  it('keeps a workspace registered under the worktree path itself', () => {
    const repo = gitRepo();
    const wt = path.join(tempDir('moo-wt-'), 'own');
    execSync(`git worktree add -q -b own "${wt}"`, { cwd: repo, stdio: 'ignore' });
    const container = createServiceContainer({ inMemory: true, projectPath: repo });
    const own = container.workspaceService.getOrCreateWorkspace(wt, 'own-wt');
    expect(container.workspaceService.resolveLocation(wt, 'never').workspace?.id).toBe(own.id);
  });
});

describe('Moving goals and pruning workspaces', () => {
  const setup = () => {
    const c = createServiceContainer({ inMemory: true, projectPath: '/test/moo-source' });
    const target = c.workspaceService.getOrCreateWorkspace('/test/moo-target', 'target');
    const source = c.activeWorkspace;
    const goal = c.goalService.createGoal('Seating plans', 'redesign seating', source.rootPath, 10, undefined, source.id);
    const outside = c.taskLifecycleService.createTask({ title: 'Shared schema', acceptanceCriteria: 'x', workspaceId: source.id }).task;
    const a = c.taskLifecycleService.createTask({ title: 'Layout', acceptanceCriteria: 'x', goalId: goal.id, workspaceId: source.id }).task;
    const b = c.taskLifecycleService.createTask({
      title: 'Legend',
      acceptanceCriteria: 'x',
      goalId: goal.id,
      workspaceId: source.id,
      dependsOnTaskIds: [outside.id],
    }).task;
    return { c, source, target, goal, outside, a, b };
  };

  it('moves a goal and all of its tasks atomically and reports links that now cross workspaces', () => {
    const { c, target, goal, outside, a, b } = setup();
    const result = c.goalService.moveGoal(goal.id, target.id);
    expect(result.movedTaskCount).toBe(2);
    expect(result.crossWorkspaceDependencies).toEqual([{ taskId: b.id, dependsOnTaskId: outside.id }]);
    expect(c.goalService.getGoal(goal.id)).toMatchObject({ workspaceId: target.id, projectPath: target.rootPath });
    expect(c.taskRepo.findById(a.id)?.workspaceId).toBe(target.id);
    expect(c.taskRepo.findById(b.id)?.workspaceId).toBe(target.id);
    expect(c.taskRepo.findById(outside.id)?.workspaceId).not.toBe(target.id);
  });

  it('refuses the Ad-hoc goal and goals with work in progress, changing nothing', () => {
    const { c, source, target, goal, a } = setup();
    const adhoc = c.goalService.getOrCreateAdhocGoal(source.id);
    expect(() => c.goalService.moveGoal(adhoc.id, target.id)).toThrow(/Ad-hoc/);

    c.claimService.claimTask(a.id, 'agent-A', 's1');
    expect(() => c.goalService.moveGoal(goal.id, target.id)).toThrow(/being worked on/);
    expect(c.goalService.getGoal(goal.id).workspaceId).toBe(source.id);
    expect(c.taskRepo.findById(a.id)?.workspaceId).toBe(source.id);
  });

  it('moves a goal from the board', async () => {
    const { c, target, goal } = setup();
    const { boardServer } = await import('./helpers.js');
    const app = boardServer(c);
    const res = await app.inject({ method: 'POST', url: `/api/goals/${goal.id}/move`, payload: { workspaceId: target.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, movedTaskCount: 2 });
    await app.close();
  });

  it('lists only workspaces nothing was tracked in, and prunes them only with --yes', async () => {
    process.env.MOO_DB_PATH = path.join(tempDir('moo-db-'), 'tasks.db');
    const { pruneWorkspacesCommand } = await import('../cli/commands/workspaces.js');
    const log = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      const c = createServiceContainer({ projectPath: '/test/used' });
      c.taskLifecycleService.createTask({ title: 'Real work', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id });
      c.workspaceService.getOrCreateWorkspace('/test/never-used');
      expect(c.workspaceService.listEmptyWorkspaces().map((w) => w.rootPath)).toEqual(['/test/never-used']);

      await pruneWorkspacesCommand({});
      expect(lines.join('\n')).toContain('/test/never-used');
      expect(c.workspaceService.listWorkspaces()).toHaveLength(2);

      await pruneWorkspacesCommand({ yes: true });
      expect(c.workspaceService.listWorkspaces().map((w) => w.rootPath)).toEqual(['/test/used']);
    } finally {
      console.log = log;
      DatabaseManager.close();
      delete process.env.MOO_DB_PATH;
    }
  });
});
