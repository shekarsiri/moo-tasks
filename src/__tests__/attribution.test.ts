import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { createServiceContainer } from '../services/index.js';
import { attributeChanges } from '../services/task-state.js';
import { claimForEdit, repoRelativePath } from '../cli/commands/hook.js';
import { DatabaseManager } from '../infrastructure/db/database.js';

const dirs: string[] = [];
afterEach(() => {
  DatabaseManager.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function repoWith(files: string[]): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'moo-attr-')));
  dirs.push(repo);
  const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
  sh('git init -q && git config user.email t@t && git config user.name t');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.test-db\n');
  for (const f of files) fs.writeFileSync(path.join(repo, f), '1\n');
  sh('git add . && git commit -qm init');
  return repo;
}

const edit = (repo: string, ...files: string[]) => files.forEach((f) => fs.writeFileSync(path.join(repo, f), `${Date.now()}\n`));

describe('Attribution of changed files', () => {
  it('two parallel claims in one checkout no longer share each other\'s files', () => {
    const repo = repoWith(['a.ts', 'b.ts', 'x.ts', 'y.ts']);
    const c = createServiceContainer({ inMemory: true, projectPath: repo });
    const ws = c.activeWorkspace.id;
    const create = (title: string, declaredFiles: string[] = []) =>
      c.taskLifecycleService.createTask({ title, acceptanceCriteria: 'x', workspaceId: ws, declaredFiles }).task;
    const streamB = create('Stream B');
    const streamD = create('Stream D');
    c.claimService.claimTask(streamB.id, 'agent-B', 'sB');
    c.claimService.claimTask(streamD.id, 'agent-D', 'sD');

    // Each agent's post-edit hook recorded its own edits; git sees all four files changed
    edit(repo, 'a.ts', 'x.ts', 'b.ts', 'y.ts');
    c.taskRepo.recordFileTouch(streamB.id, 'a.ts', 'agent-B', new Date().toISOString());
    c.taskRepo.recordFileTouch(streamB.id, 'x.ts', 'agent-B', new Date().toISOString());
    c.taskRepo.recordFileTouch(streamD.id, 'b.ts', 'agent-D', new Date().toISOString());
    c.taskRepo.recordFileTouch(streamD.id, 'y.ts', 'agent-D', new Date().toISOString());

    const b = c.verificationService.completeTask(streamB.id, 'agent-B', {});
    const d = c.verificationService.completeTask(streamD.id, 'agent-D', {});
    expect(b.evidence?.filesModified).toEqual(['a.ts', 'x.ts']);
    expect(d.evidence?.filesModified).toEqual(['b.ts', 'y.ts']);
  });

  it('without recorded edits, keeps only declared files while another agent is working', () => {
    const repo = repoWith(['a.ts', 'b.ts', 'shared.ts']);
    const c = createServiceContainer({ inMemory: true, projectPath: repo });
    const ws = c.activeWorkspace.id;
    const mine = c.taskLifecycleService.createTask({ title: 'A', acceptanceCriteria: 'x', workspaceId: ws, declaredFiles: ['a.ts'] }).task;
    const theirs = c.taskLifecycleService.createTask({ title: 'B', acceptanceCriteria: 'x', workspaceId: ws }).task;
    c.claimService.claimTask(mine.id, 'agent-A', 's1');
    c.claimService.claimTask(theirs.id, 'agent-B', 's2');
    edit(repo, 'a.ts', 'b.ts', 'shared.ts');

    expect(attributeChanges(c.taskRepo, ['a.ts', 'b.ts', 'shared.ts'], c.taskRepo.findById(mine.id)!)).toEqual(['a.ts']);
    // The other agent declared nothing and recorded nothing: it keeps what is not someone else's
    expect(attributeChanges(c.taskRepo, ['a.ts', 'b.ts', 'shared.ts'], c.taskRepo.findById(theirs.id)!)).toEqual(['b.ts', 'shared.ts']);
  });

  it('a lone agent without recorded edits keeps every changed file', () => {
    const repo = repoWith(['a.ts', 'b.ts']);
    const c = createServiceContainer({ inMemory: true, projectPath: repo });
    const t = c.taskLifecycleService.createTask({ title: 'Solo', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id, declaredFiles: ['a.ts'] }).task;
    c.claimService.claimTask(t.id, 'agent-A', 's1');
    edit(repo, 'a.ts', 'b.ts');
    expect(c.verificationService.completeTask(t.id, 'agent-A', {}).evidence?.filesModified).toEqual(['a.ts', 'b.ts']);
  });
});

describe('post-edit hook', () => {
  it('maps paths into the checkout and picks the claim an edit belongs to, or none', () => {
    const repo = repoWith(['a.ts']);
    expect(repoRelativePath(repo, path.join(repo, 'src', 'x.ts'))).toBe('src/x.ts');
    expect(repoRelativePath(repo, '/etc/hosts')).toBeNull();

    const t = (id: string, declaredFiles: string[]) => ({ id, declaredFiles }) as any;
    expect(claimForEdit([t('one', [])], 'src/x.ts')?.id).toBe('one');
    expect(claimForEdit([t('ui', ['src/ui/']), t('api', ['src/api/'])], 'src/api/routes.ts')?.id).toBe('api');
    expect(claimForEdit([t('ui', []), t('api', [])], 'src/api/routes.ts')).toBeNull();
    expect(claimForEdit([], 'src/x.ts')).toBeNull();
  });

  it('records the edited file on this session\'s claim, end to end', () => {
    const repo = repoWith(['a.ts']);
    const dbPath = path.join(repo, '.test-db', 'tasks.db');
    const c = createServiceContainer({ dbPath, projectPath: repo });
    const agent = `claude-code@${os.hostname()}:${process.pid}`;
    const t = c.taskLifecycleService.createTask({ title: 'Hooked', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    c.claimService.claimTask(t.id, agent, 's');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'x\n');

    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cli = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const res = spawnSync(tsx, [cli, 'hook', 'post-edit'], {
      input: JSON.stringify({ cwd: repo, tool_name: 'Write', tool_input: { file_path: path.join(repo, 'src', 'new.ts') } }),
      encoding: 'utf-8',
      env: { ...process.env, MOO_DB_PATH: dbPath, MOO_HOOKS: '' },
    });
    expect(res.status).toBe(0);
    expect(c.taskRepo.listTouchedFiles(t.id)).toEqual(['src/new.ts']);
  }, 30_000);
});

describe('Stop hook without a claimed task', () => {
  it('asks once to log changes the session made without a task, but not for work it completed', () => {
    const repo = repoWith(['a.ts', 'b.ts']);
    const dbPath = path.join(repo, '.test-db', 'tasks.db');
    const c = createServiceContainer({ dbPath, projectPath: repo });
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cli = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const hook = (event: string, input: object) =>
      spawnSync(tsx, [cli, 'hook', event], {
        input: JSON.stringify({ cwd: repo, ...input }),
        encoding: 'utf-8',
        env: { ...process.env, MOO_DB_PATH: dbPath, MOO_HOOKS: '' },
      }).stdout;

    // Session 1 edits a file through the shell, outside any task
    expect(hook('session-start', { session_id: 'sess-1', source: 'startup' })).toContain('MOO TASKS CONTEXT');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'changed by sed\n');
    const nudge = JSON.parse(hook('stop', { session_id: 'sess-1' }));
    expect(nudge.decision).toBe('block');
    expect(nudge.reason).toContain('a.ts');
    expect(nudge.reason).toContain('moo_log_work');
    expect(hook('stop', { session_id: 'sess-1' })).toBe('');

    // Session 2 does its work through a task and completes it: nothing to ask
    execSync('git add -A && git commit -qm wip', { cwd: repo, stdio: 'ignore' });
    hook('session-start', { session_id: 'sess-2', source: 'startup' });
    const t = c.taskLifecycleService.createTask({ title: 'Tracked', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    c.claimService.claimTask(t.id, 'agent-A', 's');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'tracked change\n');
    c.verificationService.completeTask(t.id, 'agent-A', {});
    expect(hook('stop', { session_id: 'sess-2' })).toBe('');
  }, 30_000);
});
