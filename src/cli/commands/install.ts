import fs from 'fs';
import path from 'path';
import os from 'os';
import picocolors from 'picocolors';
import { fileURLToPath } from 'url';
import { EDIT_TOOL_MATCHER } from './hook.js';

const HOOK_COMMAND_PATTERN = /\bhook (session-start|pre-edit|post-edit)\b/;

/** Shell command that runs this installation's CLI directly (no npx startup cost per edit). */
export function hookCommandPrefix(): string {
  const cli = fileURLToPath(new URL('../index.js', import.meta.url));
  return `"${process.execPath}" "${cli}" hook`;
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

function installClaudeHooks(scope: string) {
  const settingsPath =
    scope === 'user'
      ? path.join(os.homedir(), '.claude', 'settings.json')
      : path.join(process.cwd(), '.claude', 'settings.json');
  const settings = readJsonConfig(settingsPath);
  if (!settings) {
    console.log(`${picocolors.yellow('!')} ${settingsPath} is not valid JSON; hooks not installed.`);
    return;
  }
  writeJsonAtomic(settingsPath, mergeClaudeHooks(settings, hookCommandPrefix()));
  console.log(`${picocolors.green('✔')} Installed Claude Code hooks (${scope}): ${picocolors.cyan(settingsPath)}`);
  console.log(
    `  ${picocolors.dim('SessionStart resumes context; edits without a claimed task are blocked; edits renew the lease. Disable with MOO_HOOKS=off.')}`
  );
}

export async function installCommand(target: string, options: { hooks?: boolean; scope?: string } = {}) {
  const normalized = (target || 'all').toLowerCase();

  const mcpConfigEntry = {
    command: 'npx',
    args: ['-y', 'moo-tasks', 'mcp'],
  };

  console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks Multi-Agent MCP Installer'))}\n`);

  // 1. Claude Code
  if (normalized === 'claude' || normalized === 'all') {
    configureMcp('Claude Code', path.join(os.homedir(), '.claude.json'), mcpConfigEntry);
    if (options.hooks) {
      installClaudeHooks(options.scope === 'user' ? 'user' : 'project');
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
