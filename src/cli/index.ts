#!/usr/bin/env node
import { Command } from 'commander';
import { startServerCommand } from './commands/start.js';
import { mcpCommand } from './commands/mcp.js';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';

const program = new Command();

program
  .name('moo-tasks')
  .description('Agentic Task Orchestration & Management Engine with MCP and Web UI')
  .version('1.0.0');

program
  .command('start')
  .description('Start local Web UI and HTTP/SSE server')
  .option('-p, --port <number>', 'Port to listen on', '4242')
  .option('-h, --host <string>', 'Host interface to bind', '127.0.0.1')
  .option('--project-path <path>', 'Custom project root path')
  .action(startServerCommand);

program
  .command('mcp')
  .description('Start Stdio MCP server for direct AI agent integration')
  .option('--project-path <path>', 'Custom project root path')
  .action(mcpCommand);

program
  .command('init')
  .description('Initialize .moo workspace in current repository')
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
