import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { buildServer } from '../../server/app.js';

export async function startServerCommand(options: { port?: string; host?: string; projectPath?: string }) {
  const port = parseInt(options.port || '4242', 10);
  const host = options.host || '127.0.0.1';
  const container = createServiceContainer({ projectPath: options.projectPath });
  const app = buildServer(container);

  try {
    const address = await app.listen({ port, host });
    console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks Server Active!'))}`);
    console.log(`   ${picocolors.gray('Web UI:')}       ${picocolors.cyan(picocolors.underline(`http://${host}:${port}`))}`);
    console.log(`   ${picocolors.gray('REST API:')}     ${picocolors.cyan(`http://${host}:${port}/api`)}`);
    console.log(`   ${picocolors.gray('SSE Stream:')}   ${picocolors.cyan(`http://${host}:${port}/api/events`)}`);
    console.log(`   ${picocolors.gray('Project:')}      ${picocolors.yellow(container.projectPath)}`);
    console.log(`\n${picocolors.gray('Press Ctrl+C to stop.')}\n`);
  } catch (err: any) {
    console.error(picocolors.red(`Error starting server: ${err.message}`));
    process.exit(1);
  }
}
