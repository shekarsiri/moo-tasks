import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { ensureHookShim, hookShimPath, hookShimScript, readHookShim } from '../infrastructure/hook-shim.js';
import { detectVerifyCommand } from '../services/verify-detect.js';
import { HOOK_COMMAND_PATTERN, mergeClaudeHooks } from '../cli/commands/install.js';
import { DatabaseManager } from '../infrastructure/db/database.js';

const saved = { HOME: process.env.HOME, MOO_HOME: process.env.MOO_HOME, MOO_DB_PATH: process.env.MOO_DB_PATH };
let sandbox: string;

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'moo-setup-')));
  process.env.HOME = path.join(sandbox, 'home');
  process.env.MOO_HOME = path.join(sandbox, 'home', '.moo');
  process.env.MOO_DB_PATH = path.join(sandbox, 'db', 'tasks.db');
  fs.mkdirSync(process.env.HOME, { recursive: true });
});

afterEach(() => {
  DatabaseManager.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe('Hook shim', () => {
  it('runs the recorded install, survives a missing one, and is rewritten only when the install moves', () => {
    const cli = path.join(sandbox, 'fake-cli.js');
    write(cli, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const shim = ensureHookShim(process.execPath, cli);
    expect(shim).toBe(hookShimPath());
    expect(fs.statSync(shim!).mode & 0o111).toBeTruthy();
    expect(readHookShim()).toEqual({ node: process.execPath, cli });

    const run = (env: NodeJS.ProcessEnv = process.env) => spawnSync(shim!, ['pre-edit'], { encoding: 'utf-8', env });
    expect(JSON.parse(run().stdout)).toEqual(['hook', 'pre-edit']);

    // Same install: the file is left alone
    const before = fs.statSync(shim!).mtimeMs;
    ensureHookShim(process.execPath, cli);
    expect(fs.statSync(shim!).mtimeMs).toBe(before);

    // The install is gone and no moo is on PATH: exit 0 so edits and commits are never blocked
    fs.rmSync(cli);
    const gone = run({ PATH: '/usr/bin:/bin', HOME: process.env.HOME });
    expect(gone.status).toBe(0);
  });

  it('quotes paths with spaces and quotes', () => {
    const script = hookShimScript("/opt/my node/bin/node", "/x/it's/cli.js");
    expect(script).toContain(`NODE='/opt/my node/bin/node'`);
    expect(script).toContain(`CLI='/x/it'\\''s/cli.js'`);
    const file = path.join(sandbox, 'shim');
    write(file, script);
    expect(readHookShim(file)).toEqual({ node: '/opt/my node/bin/node', cli: "/x/it's/cli.js" });
  });

  it('replaces older direct hook commands with the shim form, idempotently', () => {
    const old = mergeClaudeHooks({}, '"/old/node" "/old/cli.js" hook');
    const shimmed = mergeClaudeHooks(old, '"/home/.moo/bin/moo-hook"');
    expect(mergeClaudeHooks(shimmed, '"/home/.moo/bin/moo-hook"')).toEqual(shimmed);
    expect(shimmed.hooks.PreToolUse).toHaveLength(1);
    expect(shimmed.hooks.PreToolUse[0].hooks[0].command).toBe('"/home/.moo/bin/moo-hook" pre-edit');
    expect(HOOK_COMMAND_PATTERN.test('"/home/.moo/bin/moo-hook" stop')).toBe(true);
    expect(HOOK_COMMAND_PATTERN.test('my-linter --hook stop')).toBe(false);
    expect(HOOK_COMMAND_PATTERN.test('moo hook stop')).toBe(true);
    expect(HOOK_COMMAND_PATTERN.test('npx moo-tasks hook pre-edit')).toBe(true);
  });
});

describe('Verify command detection', () => {
  const project = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'p-'));
    for (const [name, content] of Object.entries(files)) write(path.join(dir, name), content);
    return dir;
  };

  it('covers the npm family, go, cargo, pytest, flutter/dart and make', () => {
    const test = JSON.stringify({ scripts: { test: 'vitest run' } });
    expect(detectVerifyCommand(project({ 'package.json': test }))?.command).toBe('npm test');
    expect(detectVerifyCommand(project({ 'package.json': test, 'pnpm-lock.yaml': '' }))?.command).toBe('pnpm test');
    expect(detectVerifyCommand(project({ 'package.json': test, 'yarn.lock': '' }))?.command).toBe('yarn test');
    expect(detectVerifyCommand(project({ 'package.json': test, 'bun.lock': '' }))?.command).toBe('bun run test');
    expect(detectVerifyCommand(project({ 'go.mod': 'module x' }))?.command).toBe('go test ./...');
    expect(detectVerifyCommand(project({ 'Cargo.toml': '[package]' }))?.command).toBe('cargo test');
    expect(detectVerifyCommand(project({ 'pyproject.toml': '[tool.pytest.ini_options]' }))?.command).toBe('pytest');
    expect(detectVerifyCommand(project({ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' }))?.command).toBe('flutter test');
    expect(detectVerifyCommand(project({ 'pubspec.yaml': 'name: pkg\n' }))?.command).toBe('dart test');
    expect(detectVerifyCommand(project({ Makefile: 'build:\n\tgo build\ntest:\n\tgo test\n' }))?.command).toBe('make test');
  });

  it('ignores the npm placeholder test script and projects without tests', () => {
    const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
    expect(detectVerifyCommand(project({ 'package.json': placeholder }))).toBeNull();
    expect(detectVerifyCommand(project({ 'README.md': '# hi' }))).toBeNull();
  });
});

describe('moo init and moo doctor', () => {
  it('sets up hooks, git hooks and the verify command in one step, and doctor reports it', async () => {
    const repo = path.join(sandbox, 'repo');
    fs.mkdirSync(repo);
    const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: 'ignore' });
    sh('git init -q && git config user.email t@t && git config user.name t');
    write(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e 0' } }));
    sh('git add . && git commit -qm init');

    const { initCommand } = await import('../cli/commands/init.js');
    const { runDoctorChecks } = await import('../cli/commands/doctor.js');
    const log = console.log;
    console.log = () => {};
    try {
      await initCommand({ projectPath: repo, yes: true });
    } finally {
      console.log = log;
    }

    const local = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf-8'));
    expect(Object.keys(local.hooks)).toEqual(expect.arrayContaining(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']));
    expect(fs.readFileSync(path.join(repo, '.git', 'hooks', 'post-commit'), 'utf-8')).toContain('moo-tasks-hook');
    expect(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf-8')).toContain('moo_quick_start');
    // Personal settings stay out of commits (via .git/info/exclude unless already ignored globally)
    expect(execSync('git status --porcelain --untracked-files=all', { cwd: repo, encoding: 'utf-8' })).not.toContain('settings.local.json');

    const checks = await runDoctorChecks(repo);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName.workspace.status).toBe('ok');
    expect(byName['agent rules'].status).toBe('ok');
    expect(byName['git hooks'].status).toBe('ok');
    expect(byName['verify command']).toMatchObject({ status: 'ok', detail: 'npm test' });
    expect(byName['MCP server']).toMatchObject({ status: 'warn', fix: 'moo install claude' });
    expect(['ok', 'fail']).toContain(byName['Claude Code hooks'].status);

    // A hook whose program was removed (an uninstalled Node version) is reported as broken
    write(
      path.join(repo, '.claude', 'settings.local.json'),
      JSON.stringify(mergeClaudeHooks({}, '"/gone/node/bin/node" "/gone/cli.js" hook'))
    );
    const broken = (await runDoctorChecks(repo)).find((c) => c.name === 'Claude Code hooks')!;
    expect(broken.status).toBe('fail');
    expect(broken.detail).toContain('/gone/node/bin/node');
  });

  it('marks a non-git directory as a project and skips git hooks', async () => {
    const dir = path.join(sandbox, 'plain');
    fs.mkdirSync(dir);
    const { initCommand } = await import('../cli/commands/init.js');
    const log = console.log;
    console.log = () => {};
    try {
      await initCommand({ projectPath: dir, verify: false });
    } finally {
      console.log = log;
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.moo.json'), 'utf-8')).workspace).toMatch(/^ws-/);
    expect(DatabaseManager.detectProject(dir)).toMatchObject({ root: dir, isProject: true, isGit: false });
  });
});
