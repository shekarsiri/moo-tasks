import { runMcpStdio } from '../../mcp/transport-stdio.js';

export async function mcpCommand(options: { projectPath?: string }) {
  await runMcpStdio(options.projectPath);
}
