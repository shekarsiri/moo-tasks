import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMcpServer } from './server.js';
import { createServiceContainer } from '../services/index.js';

export async function runMcpStdio(projectPath?: string): Promise<void> {
  const container = createServiceContainer({ projectPath });
  const server = setupMcpServer(container);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // Log to stderr only so stdio stdout is reserved for JSON-RPC
  console.error('[moo-tasks] MCP Stdio Server running.');
}
