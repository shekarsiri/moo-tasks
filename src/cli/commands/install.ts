import fs from 'fs';
import path from 'path';
import os from 'os';
import picocolors from 'picocolors';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { EDIT_TOOL_MATCHER } from './hook.js';
import { installGitHooks } from './git-hooks.js';
import { ensureHookShim } from '../../infrastructure/hook-shim.js';

/**
 * Moo hook commands: the shim (`".../moo-hook" pre-edit`) and the older direct forms
 * (`"node" "cli.js" hook pre-edit`, `moo hook pre-edit`), but not another tool's `--hook stop`.
 */
export const HOOK_COMMAND_PATTERN = /(?:moo-hook"?|(?:\bmoo|\bmoo-tasks|"[^"]*")\s+hook)\s+(session-start|pre-edit|post-edit|stop)\b/;

/**
 * Shell command prefix hooks run: the stable shim (no npx startup per edit, and it survives Node
 * upgrades), or this install's CLI directly when the shim cannot be written.
 */
export function hookCommandPrefix(): string {
  const shim = ensureHookShim();
  if (shim) return `"${shim}"`;
  const cli = fileURLToPath(new URL('../index.js', import.meta.url));
  return `"${process.execPath}" "${cli}" hook`;
}

export type HookScope = 'user' | 'project' | 'local';

/** user: ~/.claude/settings.json; project: .claude/settings.json (shared); local: .claude/settings.local.json (personal). */
export function claudeSettingsPath(scope: HookScope, root: string = process.cwd()): string {
  if (scope === 'user') return path.join(os.homedir(), '.claude', 'settings.json');
  return path.join(root, '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

/**
 * Adds the Moo hooks to a Claude Code settings object. Earlier Moo hook entries are replaced,
 * other hooks are left untouched, so running the installer repeatedly is safe.
 */
export function mergeClaudeHooks(settings: any, commandPrefix: string): any {
  const next = { ...(settings || {}) };
  const hooks: Record<string, any[]> = { ...(next.hooks || {}) };

  const withoutMoo = (entries: any[] = []) =>
    entries
      .map((entry) => ({
        ...entry,
        hooks: (entry.hooks || []).filter((h: any) => !HOOK_COMMAND_PATTERN.test(String(h.command || ''))),
      }))
      .filter((entry) => entry.hooks.length > 0);

  const add = (event: string, command: string, matcher?: string) => {
    hooks[event] = [
      ...withoutMoo(hooks[event]),
      { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] },
    ];
  };

  add('SessionStart', `${commandPrefix} session-start`);
  add('PreToolUse', `${commandPrefix} pre-edit`, EDIT_TOOL_MATCHER);
  add('PostToolUse', `${commandPrefix} post-edit`, EDIT_TOOL_MATCHER);
  add('Stop', `${commandPrefix} stop`);

  next.hooks = hooks;
  return next;
}

/** Writes JSON via a temp file and rename, so a crash never leaves a half-written config. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

/**
 * Reads a JSON config. A missing file is an empty config; a file that does not parse (hand-edited,
 * or another tool is mid-write) returns null so the caller leaves it untouched instead of wiping it.
 */
export function readJsonConfig(filePath: string): Record<string, any> | null {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Adds the moo-tasks MCP server entry to a config file. Returns false when the file is unreadable JSON. */
export function upsertMcpServer(filePath: string, entry: Record<string, unknown>): boolean {
  const config = readJsonConfig(filePath);
  if (!config) return false;
  config.mcpServers = { ...(config.mcpServers || {}), 'moo-tasks': entry };
  writeJsonAtomic(filePath, config);
  return true;
}

function configureMcp(label: string, filePath: string, entry: Record<string, unknown>) {
  try {
    if (upsertMcpServer(filePath, entry)) {
      console.log(`${picocolors.green('✔')} Configured ${label}: ${picocolors.cyan(filePath)}`);
    } else {
      console.log(`${picocolors.yellow('!')} ${filePath} is not valid JSON; left untouched. Fix it and re-run the installer.`);
    }
  } catch (err: any) {
    console.log(`${picocolors.yellow('!')} ${label} config update skipped: ${err.message}`);
  }
}

/**
 * Keeps a personal file out of commits through `.git/info/exclude`, which is local to this clone,
 * so no tracked file (such as .gitignore) changes. Ignored when the directory is not a git repo.
 */
export function excludeFromGit(root: string, relativePath: string): boolean {
  try {
    const ignored = (() => {
      try {
        execFileSync('git', ['check-ignore', '-q', relativePath], { cwd: root, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    if (ignored) return false;
    const exclude = path.resolve(
      root,
      execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    );
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf-8') : '';
    fs.writeFileSync(exclude, `${current}${current && !current.endsWith('\n') ? '\n' : ''}/${relativePath}\n`);
    return true;
  } catch {
    return false;
  }
}

export function installClaudeHooks(scope: HookScope, root: string = process.cwd()): boolean {
  const settingsPath = claudeSettingsPath(scope, root);
  const settings = readJsonConfig(settingsPath);
  if (!settings) {
    console.log(`${picocolors.yellow('!')} ${settingsPath} is not valid JSON; hooks not installed.`);
    return false;
  }
  writeJsonAtomic(settingsPath, mergeClaudeHooks(settings, hookCommandPrefix()));
  if (scope === 'local') excludeFromGit(root, '.claude/settings.local.json');
  console.log(`${picocolors.green('✔')} Installed Claude Code hooks (${scope}): ${picocolors.cyan(settingsPath)}`);
  console.log(
    `  ${picocolors.dim('SessionStart resumes context (full after compaction); edits without a claimed task are blocked; edits renew the lease; Stop asks for a checkpoint on unsaved progress. Disable with MOO_HOOKS=off.')}`
  );
  return true;
}

export function installGitHooksHere(root: string = process.cwd()): boolean {
  try {
    for (const r of installGitHooks(root, hookCommandPrefix())) {
      if (r.result === 'skipped-foreign') {
        console.log(
          `${picocolors.yellow('!')} ${r.path} belongs to another tool; add this line to it to link commits to tasks:\n    ${hookCommandPrefix()} ${r.hook} "$@" || true`
        );
      } else {
        console.log(`${picocolors.green('✔')} ${r.result === 'installed' ? 'Installed' : 'Updated'} git ${r.hook} hook: ${picocolors.cyan(r.path)}`);
      }
    }
    return true;
  } catch (err: any) {
    console.log(`${picocolors.yellow('!')} Git hooks not installed (not a git repository?): ${err.message}`);
    return false;
  }
}

export async function installCommand(target: string, options: { hooks?: boolean; gitHooks?: boolean; scope?: string } = {}) {
  const normalized = (target || 'all').toLowerCase();

  if (normalized === 'git' || options.gitHooks) {
    installGitHooksHere();
    if (normalized === 'git') return;
  }

  const mcpConfigEntry = {
    command: 'npx',
    args: ['-y', 'moo-tasks', 'mcp'],
  };

  console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks Multi-Agent MCP Installer'))}\n`);

  // 1. Claude Code
  if (normalized === 'claude' || normalized === 'all') {
    configureMcp('Claude Code', path.join(os.homedir(), '.claude.json'), mcpConfigEntry);
    if (options.hooks) {
      installClaudeHooks(options.scope === 'user' || options.scope === 'local' ? options.scope : 'project');
    }
  }

  // 2. Cursor (.cursor/mcp.json)
  if (normalized === 'cursor' || normalized === 'all') {
    configureMcp('Cursor', path.join(process.cwd(), '.cursor', 'mcp.json'), mcpConfigEntry);
  }

  // 3. Windsurf (~/.codeium/windsurf/mcp_config.json), only when Windsurf is installed
  if (normalized === 'windsurf' || normalized === 'all') {
    const windsurfDir = path.join(os.homedir(), '.codeium', 'windsurf');
    if (fs.existsSync(windsurfDir)) {
      configureMcp('Windsurf', path.join(windsurfDir, 'mcp_config.json'), mcpConfigEntry);
    }
  }

  // 4. Antigravity / Gemini CLI (.gemini/settings.json)
  if (normalized === 'antigravity' || normalized === 'agy' || normalized === 'all') {
    configureMcp('Antigravity', path.join(process.cwd(), '.gemini', 'settings.json'), mcpConfigEntry);
  }

  // 5. Generic MCP Snippet
  if (normalized === 'codex' || normalized === 'generic' || normalized === 'all') {
    const codexSnippet = {
      mcpServers: {
        'moo-tasks': mcpConfigEntry,
      },
    };
    console.log(`\n${picocolors.bold(picocolors.white('Universal MCP Configuration Snippet:'))}`);
    console.log(picocolors.cyan(JSON.stringify(codexSnippet, null, 2)));
  }

  console.log(`\n${picocolors.green('✔ Installation completed successfully.')}`);
  console.log(`\n${picocolors.bold(picocolors.white('💡 Global CLI Usage:'))}`);
  console.log(`  To run bare ${picocolors.cyan('moo')} commands without npx, install globally:`);
  console.log(`    ${picocolors.yellow('npm install -g moo-tasks')}`);
  console.log(`  Then you can run:`);
  console.log(`    ${picocolors.cyan('moo start')}    ${picocolors.dim('# Launch local Web UI (http://127.0.0.1:4242)')}`);
  console.log(`    ${picocolors.cyan('moo init')}     ${picocolors.dim('# Initialize project workspace & rules')}`);
  console.log(`    ${picocolors.cyan('moo ws')}       ${picocolors.dim('# List global workspaces')}`);
  console.log(`    ${picocolors.cyan('moo status')}   ${picocolors.dim('# View Where-Did-I-Leave-Off context')}\n`);
}
