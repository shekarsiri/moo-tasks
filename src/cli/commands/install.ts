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

  console.log(`\n${picocolors.green('✔ Installation completed successfully.')}\n`);
}
