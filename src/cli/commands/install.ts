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

function installClaudeHooks(scope: string) {
  const settingsPath =
    scope === 'user'
      ? path.join(os.homedir(), '.claude', 'settings.json')
      : path.join(process.cwd(), '.claude', 'settings.json');
  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.log(`${picocolors.yellow('!')} ${settingsPath} is not valid JSON; hooks not installed.`);
      return;
    }
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(mergeClaudeHooks(settings, hookCommandPrefix()), null, 2) + '\n');
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
    try {
      const claudeConfigPath = path.join(os.homedir(), '.claude.json');
      let config: any = {};
      if (fs.existsSync(claudeConfigPath)) {
        try {
          config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
        } catch {
          config = {};
        }
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers['moo-tasks'] = mcpConfigEntry;
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      console.log(`${picocolors.green('✔')} Configured Claude Code: ${picocolors.cyan(claudeConfigPath)}`);
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Claude Code config update skipped: ${err.message}`);
    }
    if (options.hooks) {
      installClaudeHooks(options.scope === 'user' ? 'user' : 'project');
    }
  }

  // 2. Cursor (.cursor/mcp.json)
  if (normalized === 'cursor' || normalized === 'all') {
    try {
      const cursorDir = path.join(process.cwd(), '.cursor');
      if (!fs.existsSync(cursorDir)) {
        fs.mkdirSync(cursorDir, { recursive: true });
      }
      const cursorMcpPath = path.join(cursorDir, 'mcp.json');
      let config: any = {};
      if (fs.existsSync(cursorMcpPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cursorMcpPath, 'utf-8'));
        } catch {
          config = {};
        }
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers['moo-tasks'] = mcpConfigEntry;
      fs.writeFileSync(cursorMcpPath, JSON.stringify(config, null, 2));
      console.log(`${picocolors.green('✔')} Configured Cursor: ${picocolors.cyan(cursorMcpPath)}`);
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Cursor config update skipped: ${err.message}`);
    }
  }

  // 3. Windsurf (~/.codeium/windsurf/mcp_config.json)
  if (normalized === 'windsurf' || normalized === 'all') {
    try {
      const windsurfDir = path.join(os.homedir(), '.codeium', 'windsurf');
      if (fs.existsSync(windsurfDir)) {
        const windsurfMcpPath = path.join(windsurfDir, 'mcp_config.json');
        let config: any = {};
        if (fs.existsSync(windsurfMcpPath)) {
          try {
            config = JSON.parse(fs.readFileSync(windsurfMcpPath, 'utf-8'));
          } catch {
            config = {};
          }
        }
        config.mcpServers = config.mcpServers || {};
        config.mcpServers['moo-tasks'] = mcpConfigEntry;
        fs.writeFileSync(windsurfMcpPath, JSON.stringify(config, null, 2));
        console.log(`${picocolors.green('✔')} Configured Windsurf: ${picocolors.cyan(windsurfMcpPath)}`);
      }
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Windsurf config update skipped: ${err.message}`);
    }
  }

  // 4. Antigravity / Gemini CLI (.gemini/settings.json)
  if (normalized === 'antigravity' || normalized === 'agy' || normalized === 'all') {
    try {
      const geminiDir = path.join(process.cwd(), '.gemini');
      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true });
      }
      const mcpSettingsPath = path.join(geminiDir, 'settings.json');
      let config: any = {};
      if (fs.existsSync(mcpSettingsPath)) {
        try {
          config = JSON.parse(fs.readFileSync(mcpSettingsPath, 'utf-8'));
        } catch {
          config = {};
        }
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers['moo-tasks'] = mcpConfigEntry;
      fs.writeFileSync(mcpSettingsPath, JSON.stringify(config, null, 2));
      console.log(`${picocolors.green('✔')} Configured Antigravity: ${picocolors.cyan(mcpSettingsPath)}`);
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Antigravity config update skipped: ${err.message}`);
    }
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
