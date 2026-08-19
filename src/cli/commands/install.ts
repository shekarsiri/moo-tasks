import fs from 'fs';
import path from 'path';
import os from 'os';
import picocolors from 'picocolors';

export async function installCommand(target: string) {
  const normalized = (target || 'all').toLowerCase();

  const mcpConfigEntry = {
    command: 'npx',
    args: ['moo-tasks', 'mcp'],
  };

  console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks Plugin Installer'))}\n`);

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
      console.log(`${picocolors.green('✔')} Configured Claude Code MCP: ${picocolors.cyan(claudeConfigPath)}`);
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Claude Code config update skipped: ${err.message}`);
    }
  }

  // 2. Antigravity / Gemini CLI
  if (normalized === 'antigravity' || normalized === 'agy' || normalized === 'all') {
    try {
      const projectRoot = process.cwd();
      const geminiDir = path.join(projectRoot, '.gemini');
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
      console.log(`${picocolors.green('✔')} Configured Antigravity MCP: ${picocolors.cyan(mcpSettingsPath)}`);
    } catch (err: any) {
      console.log(`${picocolors.yellow('!')} Antigravity config update skipped: ${err.message}`);
    }
  }

  // 3. Codex / Generic MCP Config
  if (normalized === 'codex' || normalized === 'all') {
    const codexSnippet = {
      mcpServers: {
        'moo-tasks': mcpConfigEntry,
      },
    };
    console.log(`\n${picocolors.bold(picocolors.white('Codex / Generic MCP Configuration:'))}`);
    console.log(picocolors.cyan(JSON.stringify(codexSnippet, null, 2)));
  }

  console.log(`\n${picocolors.green('✔ Installation completed.')}\n`);
}
