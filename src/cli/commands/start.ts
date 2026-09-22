import os from 'os';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { buildServer } from '../../server/app.js';
import { probeWebUi } from '../../infrastructure/web/web-ui.js';

function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (netList) {
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push(net.address);
        }
      }
    }
  }

  return addresses;
}

export async function startServerCommand(options: {
  port?: string;
  host?: string;
  lan?: boolean;
  projectPath?: string;
}) {
  const port = parseInt(options.port || '4242', 10);
  const host = options.lan ? '0.0.0.0' : options.host || '127.0.0.1';
  const container = createServiceContainer({ projectPath: options.projectPath });
  const app = buildServer(container, { lan: host === '0.0.0.0' });

  try {
    await app.listen({ port, host });
    const lanIps = getLocalIpAddresses();

    console.log(`\n${picocolors.bold(picocolors.blue('🐮 Moo Tasks Server Active!'))}`);
    console.log(`   ${picocolors.gray('Local:')}        ${picocolors.cyan(picocolors.underline(`http://localhost:${port}`))}`);

    if (host === '0.0.0.0' || options.lan) {
      if (lanIps.length > 0) {
        for (const ip of lanIps) {
          console.log(`   ${picocolors.gray('Intranet / LAN:')} ${picocolors.green(picocolors.underline(`http://${ip}:${port}`))}`);
        }
      } else {
        console.log(`   ${picocolors.gray('Network:')}      ${picocolors.cyan(picocolors.underline(`http://0.0.0.0:${port}`))}`);
      }
    } else {
      console.log(`   ${picocolors.gray('Tip:')}          ${picocolors.dim(`Run with ${picocolors.yellow('moo-tasks start --host 0.0.0.0')} or ${picocolors.yellow('--lan')} to access across intranet`)}`);
    }

    console.log(`   ${picocolors.gray('REST API:')}     ${picocolors.cyan(`http://localhost:${port}/api`)}`);
    console.log(`   ${picocolors.gray('SSE Stream:')}   ${picocolors.cyan(`http://localhost:${port}/api/events`)}`);
    console.log(`   ${picocolors.gray('Project:')}      ${picocolors.yellow(container.projectPath)}`);
    console.log(`\n${picocolors.gray('Press Ctrl+C to stop.')}\n`);
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE' && (await probeWebUi(port))) {
      // Another agent session (or an earlier `moo start`) already runs the shared board.
      console.log(`${picocolors.green('✔')} Moo Tasks board already running at ${picocolors.cyan(`http://localhost:${port}`)}`);
      process.exit(0);
    }
    console.error(picocolors.red(`Error starting server: ${err.message}`));
    process.exit(1);
  }
}
