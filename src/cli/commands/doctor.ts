import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import picocolors from 'picocolors';
import { VERSION } from '../../version.js';
import { createServiceContainer } from '../../services/index.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';
import { hookShimPath, readHookShim, ensureHookShim } from '../../infrastructure/hook-shim.js';
import { probeWebUi, webUiPort, webUiUrl } from '../../infrastructure/web/web-ui.js';
import { detectVerifyCommand } from '../../services/verify-detect.js';
import { GIT_HOOK_MARKER } from './git-hooks.js';
import { claudeSettingsPath, HOOK_COMMAND_PATTERN, HookScope, readJsonConfig } from './install.js';
import { MOO_BLOCK_START } from './init.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Command or action that fixes a warn/fail. */
  fix?: string;
}

/** The first path a hook command runs (`"/path/x" pre-edit` or `/path/x hook ...`). */
function commandTarget(command: string): string {
  const m = command.match(/^\s*"([^"]+)"/) || command.match(/^\s*(\S+)/);
  return m ? m[1] : '';
}

function claudeHookScopes(root: string): { scope: HookScope; file: string; broken: string[] }[] {
  const found: { scope: HookScope; file: string; broken: string[] }[] = [];
  for (const scope of ['local', 'project', 'user'] as HookScope[]) {
    const file = claudeSettingsPath(scope, root);
    const settings = fs.existsSync(file) ? readJsonConfig(file) : null;
    const commands: string[] = Object.values((settings?.hooks || {}) as Record<string, any[]>)
      .flat()
      .flatMap((entry: any) => (entry?.hooks || []).map((h: any) => String(h?.command || '')))
      .filter((c: string) => HOOK_COMMAND_PATTERN.test(c));
    if (commands.length === 0) continue;
    // A hook whose program no longer exists (a removed Node version) fails silently on every edit.
    const broken = [...new Set(commands.map(commandTarget).filter((t) => path.isAbsolute(t) && !fs.existsSync(t)))];
    found.push({ scope, file, broken });
  }
  return found;
}

function mcpConfigured(root: string): string | null {
  const claudeJson = readJsonConfig(path.join(os.homedir(), '.claude.json'));
  if (claudeJson?.mcpServers?.['moo-tasks']) return '~/.claude.json (user)';
  if (claudeJson?.projects?.[root]?.mcpServers?.['moo-tasks']) return '~/.claude.json (this project)';
  if (readJsonConfig(path.join(root, '.mcp.json'))?.mcpServers?.['moo-tasks']) return '.mcp.json';
  if (readJsonConfig(path.join(root, '.cursor', 'mcp.json'))?.mcpServers?.['moo-tasks']) return '.cursor/mcp.json';
  return null;
}

function gitHooksState(root: string): { installed: string[]; missing: string[] } | null {
  try {
    const dir = path.resolve(
      root,
      execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    );
    const state = { installed: [] as string[], missing: [] as string[] };
    for (const hook of ['prepare-commit-msg', 'post-commit']) {
      const file = path.join(dir, hook);
      const ours = fs.existsSync(file) && fs.readFileSync(file, 'utf-8').includes(GIT_HOOK_MARKER);
      (ours ? state.installed : state.missing).push(hook);
    }
    return state;
  } catch {
    return null;
  }
}

const fileSize = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

export async function runDoctorChecks(cwd: string = process.cwd()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: CheckStatus, detail: string, fix?: string) => checks.push({ name, status, detail, fix });

  add('moo', 'ok', `v${VERSION} on Node ${process.versions.node}`);

  const container = createServiceContainer({ projectPath: cwd, register: 'never' });
  const ws = container.activeWorkspace;
  const root = container.projectPath;
  if (!ws) {
    add('workspace', 'fail', `${root} is not registered`, 'moo init');
  } else {
    const worktree = container.location.checkoutRoot !== container.location.repoRoot ? ` (worktree of ${container.location.repoRoot})` : '';
    add('workspace', 'ok', `${ws.name} → ${ws.rootPath}${worktree}`);
  }

  const agentsMd = path.join(root, 'AGENTS.md');
  const hasBlock = fs.existsSync(agentsMd) && fs.readFileSync(agentsMd, 'utf-8').includes(MOO_BLOCK_START.split(' (')[0]);
  add('agent rules', hasBlock ? 'ok' : 'warn', hasBlock ? 'AGENTS.md carries the Moo protocol' : 'AGENTS.md has no Moo protocol block (MCP server instructions still apply)', hasBlock ? undefined : 'moo init');

  const mcp = mcpConfigured(root);
  add('MCP server', mcp ? 'ok' : 'warn', mcp ? `configured in ${mcp}` : 'no moo-tasks entry found for Claude Code or Cursor', mcp ? undefined : 'moo install claude');

  const hookScopes = claudeHookScopes(root);
  const broken = hookScopes.flatMap((h) => h.broken.map((b) => `${h.scope}: ${b}`));
  if (hookScopes.length === 0) {
    add('Claude Code hooks', 'warn', 'not installed: edits are not gated on a claimed task and no checkpoint reminders', 'moo install claude --hooks --scope local');
  } else if (broken.length > 0) {
    add('Claude Code hooks', 'fail', `hook program missing (${broken.join(', ')})`, 'moo install claude --hooks --scope ' + hookScopes[0].scope);
  } else {
    add('Claude Code hooks', 'ok', `installed (${hookScopes.map((h) => h.scope).join(', ')})`);
  }

  const shim = readHookShim();
  if (shim) {
    const shimOk = fs.existsSync(shim.node) && fs.existsSync(shim.cli);
    if (!shimOk) ensureHookShim();
    const repaired = readHookShim();
    const ok = Boolean(repaired && fs.existsSync(repaired.node) && fs.existsSync(repaired.cli));
    add(
      'hook shim',
      ok ? 'ok' : 'warn',
      ok ? `${hookShimPath()} → ${repaired!.cli}${shimOk ? '' : ' (repointed)'}` : `${hookShimPath()} points at a missing install; it falls back to moo on PATH`,
      ok ? undefined : 'npm install -g moo-tasks'
    );
  }

  const gitHooks = gitHooksState(root);
  if (gitHooks) {
    add(
      'git hooks',
      gitHooks.missing.length === 0 ? 'ok' : 'warn',
      gitHooks.missing.length === 0 ? 'commits are linked to tasks' : `missing ${gitHooks.missing.join(', ')}: commits are not linked to tasks`,
      gitHooks.missing.length === 0 ? undefined : 'moo install git'
    );
  }

  if (ws) {
    if (ws.verifyCommand) {
      add('verify command', 'ok', ws.verifyCommand);
    } else {
      const detected = detectVerifyCommand(root);
      add(
        'verify command',
        'warn',
        'not set: completed tasks are not checked',
        detected ? `moo verify:set "${detected.command}"` : 'moo verify:set "<your test command>"'
      );
    }

    const summary = container.sessionService.whereDidILeaveOff(root, undefined, ws.id);
    if (summary.goalsReadyToClose.length > 0) {
      add('finished goals', 'warn', `${summary.goalsReadyToClose.length} active goal(s) have no open tasks`, 'close them on the board, or moo_update_goal(status: completed)');
    }
    if (summary.staleTasks.length > 0) {
      add('stale backlog', 'warn', `${summary.staleTasks.length} task(s) untouched for weeks or pointing at missing files`, 'moo list --stale, then drop or reschedule');
    }
  }

  const port = webUiPort();
  const boardUp = await probeWebUi(port);
  add('board', boardUp ? 'ok' : 'warn', boardUp ? `running at ${webUiUrl(port)}` : `not running on port ${port}`, boardUp ? undefined : 'moo start');

  const dbPath = DatabaseManager.resolveGlobalDbPath();
  const mb = (fileSize(dbPath) + fileSize(`${dbPath}-wal`)) / 1024 / 1024;
  add('database', mb > 200 ? 'warn' : 'ok', `${dbPath} (${mb.toFixed(1)} MB)`, mb > 200 ? 'moo db:compact' : undefined);

  const empty = container.workspaceService.listEmptyWorkspaces();
  if (empty.length > 0) {
    add('workspaces', 'warn', `${empty.length} empty workspace(s): ${empty.map((w) => w.name).join(', ')}`, 'moo ws:prune');
  }

  return checks;
}

export async function doctorCommand(options: { projectPath?: string; json?: boolean }) {
  const checks = await runDoctorChecks(options.projectPath ? path.resolve(options.projectPath) : process.cwd());
  if (options.json) {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }
  const icon = { ok: picocolors.green('✔'), warn: picocolors.yellow('!'), fail: picocolors.red('✖') };
  console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks doctor'))}\n`);
  for (const c of checks) {
    console.log(`${icon[c.status]} ${picocolors.bold(c.name)}: ${c.detail}`);
    if (c.fix) console.log(`    ${picocolors.dim('fix:')} ${picocolors.cyan(c.fix)}`);
  }
  const problems = checks.filter((c) => c.status !== 'ok').length;
  console.log(problems ? `\n${problems} item(s) to look at.\n` : `\n${picocolors.green('All good.')}\n`);
  if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
}
