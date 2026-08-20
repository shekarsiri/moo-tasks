#!/usr/bin/env node
import fs from 'fs';
import { Command } from 'commander';
import { startServerCommand } from './commands/start.js';
import { mcpCommand } from './commands/mcp.js';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { nextCommand } from './commands/next.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { searchCommand } from './commands/search.js';
import {
  workspacesCommand,
  addWorkspaceCommand,
  renameWorkspaceCommand,
  setRemoteWorkspaceCommand,
  removeWorkspaceCommand,
} from './commands/workspaces.js';

let version = '1.0.4';
try {
  const pkgPath = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = pkg.version || version;
} catch {}

const program = new Command();

program
  .name('moo-tasks')
  .description('Agentic Task Orchestration & Management Engine with MCP and Web UI')
  .version(version);

program
  .command('workspaces')
  .alias('ws')
  .description('List registered project workspaces in the global Moo Tasks registry')
  .option('--json', 'Output raw JSON')
  .option('--project-path <path>', 'Custom project root path')
  .action(workspacesCommand);

program
  .command('workspaces:add <path>')
  .alias('ws:add')
  .description('Register a project directory as a workspace')
  .option('-n, --name <name>', 'Custom workspace name')
  .action(addWorkspaceCommand);

program
  .command('workspaces:rename <idOrName> <newName>')
  .alias('ws:rename')
  .description('Set or update the display name of a workspace')
  .action(renameWorkspaceCommand);

program
  .command('workspaces:remote <idOrName> <remoteUrl>')
  .alias('ws:remote')
  .description('Set or update git remote URL for a workspace')
  .action(setRemoteWorkspaceCommand);

program
  .command('workspaces:remove <idOrName>')
  .alias('workspaces:delete')
  .alias('ws:remove')
  .alias('ws:delete')
  .description('Unregister a workspace from the global registry')
  .action(removeWorkspaceCommand);

program
  .command('search <query>')
  .description('Full-text search (SQLite FTS5) across tasks, acceptance criteria, and architectural decisions')
  .option('-t, --type <type>', 'Filter type (all, tasks, decisions)', 'all')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--json', 'Output raw JSON')
  .option('--project-path <path>', 'Custom project root path')
  .action(searchCommand);

program
  .command('import <file>')
  .description('Import markdown design doc, PRD, or task checklist into Goal and Tasks with dependencies')
  .option('-g, --goal <goalId>', 'Attach imported tasks to existing Goal ID')
  .option('-t, --title <title>', 'Custom Goal title')
  .option('--sequential', 'Link tasks in sequential phases as dependencies')
  .option('--project-path <path>', 'Custom project root path')
  .action(importCommand);

program
  .command('run <prompt>')
  .description('Record user prompt as Goal and create claimed task with compact context for coding agents')
  .option('-t, --title <title>', 'Descriptive goal title')
  .option('-p, --priority <priority>', 'Task priority (low, medium, high, critical)', 'high')
  .option('-a, --agent <agentId>', 'Agent identifier', 'cli-agent')
  .option('-f, --files <files>', 'Comma-separated declared files')
  .option('--project-path <path>', 'Custom project root path')
  .action(runCommand);

program
  .command('status')
  .alias('resume')
  .description('Show Where-Did-I-Leave-Off session resume overview and compact context')
  .option('-a, --agent <agentId>', 'Agent identifier')
  .option('--raw', 'Output raw compact context string')
  .option('--project-path <path>', 'Custom project root path')
  .action(statusCommand);

program
  .command('list')
  .alias('tasks')
  .description('List and filter tasks from the local SQLite database')
  .option('-g, --goal <goalId>', 'Filter by Goal ID')
  .option('-s, --status <status>', 'Filter by Status (todo, doing, blocked-on-dependency, waiting-on-human, done, dropped)')
  .option('-p, --priority <priority>', 'Filter by Priority (low, medium, high, critical)')
  .option('-t, --type <type>', 'Filter by Task Type (feature, bug, refactor, test, docs, chore, spike, security)')
  .option('--tag <tag>', 'Filter by Tag name')
  .option('-a, --agent <agentId>', 'Filter by claimed agent')
  .option('--deferred', 'Include or filter deferred tasks')
  .option('--json', 'Output raw JSON')
  .option('--project-path <path>', 'Custom project root path')
  .action(listCommand);

program
  .command('next')
  .description('Auto-surface the next unblocked, highest-priority task ready for work')
  .option('-g, --goal <goalId>', 'Filter by Goal ID')
  .option('--json', 'Output raw JSON')
  .option('--project-path <path>', 'Custom project root path')
  .action(nextCommand);

program
  .command('export')
  .description('Export all goals, tasks, and architectural decisions')
  .option('-f, --format <format>', 'Export format (markdown, json, text)', 'markdown')
  .option('-o, --out <filepath>', 'Output file path (default: stdout)')
  .option('--project-path <path>', 'Custom project root path')
  .action(exportCommand);

program
  .command('start')
  .description('Start local Web UI and HTTP/SSE server')
  .option('-p, --port <number>', 'Port to listen on', '4242')
  .option('-h, --host <string>', 'Host interface to bind', '127.0.0.1')
  .option('--lan', 'Bind to 0.0.0.0 to enable intranet / local network access across devices')
  .option('--project-path <path>', 'Custom project root path')
  .action(startServerCommand);

program
  .command('mcp')
  .description('Start Stdio MCP server for direct AI agent integration')
  .option('--project-path <path>', 'Custom project root path')
  .action(mcpCommand);

program
  .command('init')
  .description('Initialize .moo workspace in current repository (or update rules)')
  .option('-f, --force', 'Overwrite and refresh existing AGENTS.md, CLAUDE.md, and rule files with latest protocol')
  .option('--rules', 'Refresh agent guidelines and prompt rule files')
  .option('--project-path <path>', 'Custom project root path')
  .action(initCommand);

program
  .command('install [target]')
  .description('Install & configure MCP plugin for claude, antigravity, codex, or all')
  .action(installCommand);

// Default to start command if no subcommand provided
if (process.argv.length <= 2) {
  process.argv.push('start');
}

program.parse(process.argv);
