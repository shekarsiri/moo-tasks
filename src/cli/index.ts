#!/usr/bin/env node
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

const program = new Command();

program
  .name('moo-tasks')
  .description('Agentic Task Orchestration & Management Engine with MCP and Web UI')
  .version('1.0.0');

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
