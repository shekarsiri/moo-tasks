import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createServiceContainer, RegisteredContainer } from '../services/index.js';
import { buildServer } from '../server/app.js';
import { boardToken, cookieValue, isLoopback } from '../server/board-auth.js';
import { DatabaseManager } from '../infrastructure/db/database.js';

const TOKEN = 'a'.repeat(48);
const LAN = '192.168.1.20';

describe('Board token', () => {
  let c: RegisteredContainer;
  let app: ReturnType<typeof buildServer>;
  let taskId: string;

  beforeEach(() => {
    c = createServiceContainer({ inMemory: true, projectPath: '/test/board-auth' });
    const t = c.taskLifecycleService.createTask({ title: 'Agent work', acceptanceCriteria: 'x', workspaceId: c.activeWorkspace.id }).task;
    c.claimService.claimTask(t.id, 'agent-A', 's1');
    c.verificationService.completeTask(t.id, 'agent-A', { outputSnippet: 'ok' });
    taskId = t.id;
    app = buildServer(c, { token: TOKEN, lan: true });
  });
  afterEach(async () => {
    await app.close();
  });

  it('keeps local reads open but refuses local writes without the token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(200);

    const curl = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/verify`, payload: {} });
    expect(curl.statusCode).toBe(403);
    expect(curl.json().code).toBe('BOARD_TOKEN_REQUIRED');
    expect(c.taskRepo.findById(taskId)?.verificationState).toBe('agent_completed');

    const status = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/status`, payload: { status: 'todo' } });
    expect(status.statusCode).toBe(403);

    const board = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/verify`, payload: {}, headers: { 'x-moo-token': TOKEN } });
    expect(board.statusCode).toBe(200);
    expect(c.taskRepo.findById(taskId)?.verificationState).toBe('verified_done');
  });

  it('serves the board page with its token so the board keeps working', async () => {
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`<meta name="moo-token" content="${TOKEN}">`);
    expect(page.headers['cache-control']).toBe('no-store');
  });

  it('requires the token for every request from another device, taken once from the link', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/tasks', remoteAddress: LAN });
    expect(anon.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/', remoteAddress: LAN })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: LAN })).statusCode).toBe(200);

    const link = await app.inject({ method: 'GET', url: `/?token=${TOKEN}`, remoteAddress: LAN });
    expect(link.statusCode).toBe(302);
    expect(link.headers.location).toBe('/');
    const cookie = String(link.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookieValue(cookie.split(';')[0], 'moo_token')).toBe(TOKEN);

    const withCookie = await app.inject({ method: 'GET', url: '/api/tasks', remoteAddress: LAN, headers: { cookie: `moo_token=${TOKEN}` } });
    expect(withCookie.statusCode).toBe(200);
    const wrong = await app.inject({ method: 'GET', url: `/?token=${'b'.repeat(48)}`, remoteAddress: LAN });
    expect(wrong.statusCode).toBe(401);
  });

  it('recognizes loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('Token file and verify command', () => {
  const saved = process.env.MOO_DB_PATH;
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moo-token-'));
  });
  afterEach(() => {
    DatabaseManager.close();
    if (saved === undefined) delete process.env.MOO_DB_PATH;
    else process.env.MOO_DB_PATH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the token once, readable by its owner only', () => {
    const file = path.join(dir, 'board-token');
    const token = boardToken(file);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(boardToken(file)).toBe(token);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('lets anyone set the first verify command but only a terminal change it', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const env = { ...process.env, MOO_DB_PATH: path.join(dir, 'tasks.db'), MOO_NO_UI: '1' };
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cli = path.join(process.cwd(), 'src', 'cli', 'index.ts');
    const run = (...args: string[]) => spawnSync(tsx, [cli, ...args, '--project-path', repo], { encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'pipe'] });

    const first = run('verify:set', 'npm test');
    expect(first.status).toBe(0);
    const change = run('verify:set', 'true');
    expect(change.status).toBe(1);
    expect(change.stderr).toContain('interactive terminal');
    expect(run('verify:set', '--clear').status).toBe(1);
    expect(run('verify:set').stdout).toContain('npm test');
  }, 30_000);
});
