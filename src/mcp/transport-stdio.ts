import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMcpServer } from './server.js';
import { createServiceContainer } from '../services/index.js';
import { ensureWebUi, isWebUiAutostartDisabled, webUiUrl } from '../infrastructure/web/web-ui.js';
import { refreshHookShim } from '../infrastructure/hook-shim.js';

export async function runMcpStdio(projectPath?: string): Promise<void> {
  const container = createServiceContainer({ projectPath, register: 'if-project' });
  container.goalService.closeIdleGoals(container.activeWorkspace?.id);
  const server = setupMcpServer(container, {
    webUiUrl: isWebUiAutostartDisabled() ? undefined : webUiUrl(),
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // Log to stderr only so stdio stdout is reserved for JSON-RPC
  console.error('[moo-tasks] MCP Stdio Server running.');

  // Hooks run the shim; point it at this install in case Node or moo moved since it was written.
  refreshHookShim();

  // The board is shared by every agent on this machine; start it in the background if needed.
  ensureWebUi(container.projectPath)
    .then((ui) => {
      if (ui?.started) console.error(`[moo-tasks] Started web board at ${ui.url}`);
    })
    .catch((err) => console.error(`[moo-tasks] Web board autostart skipped: ${err?.message || err}`));
}
