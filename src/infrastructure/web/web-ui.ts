import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '../db/database.js';

export const DEFAULT_WEB_UI_PORT = 4242;

export function webUiPort(): number {
  const fromEnv = parseInt(process.env.MOO_PORT || '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_WEB_UI_PORT;
}

export function webUiUrl(port: number = webUiPort()): string {
  return `http://localhost:${port}`;
}

/** Resolves true only when a Moo Tasks board (not some other service) answers on the port. */
export function probeWebUi(port: number = webUiPort(), timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).service === 'moo-tasks');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

export function isWebUiAutostartDisabled(): boolean {
  const flag = (process.env.MOO_NO_UI || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Makes sure the board is running, starting it as a detached background process if not.
 * The board serves every workspace, so one instance per machine is shared by all agents.
 */
export async function ensureWebUi(projectPath?: string): Promise<{ url: string; started: boolean } | null> {
  if (isWebUiAutostartDisabled()) return null;
  const port = webUiPort();
  const url = webUiUrl(port);
  if (await probeWebUi(port)) return { url, started: false };

  const cliEntry = fileURLToPath(new URL('../../cli/index.js', import.meta.url));
  const entry = fs.existsSync(cliEntry) ? cliEntry : cliEntry.replace(/\.js$/, '.ts');
  if (!fs.existsSync(entry)) return null;

  const logPath = path.join(DatabaseManager.getGlobalMooDir(), 'web-ui.log');
  const log = fs.openSync(logPath, 'a');
  const args = [...process.execArgv, entry, 'start', '--port', String(port)];
  if (projectPath) args.push('--project-path', projectPath);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, MOO_NO_UI: '1' },
  });
  child.unref();
  fs.closeSync(log);
  return { url, started: true };
}
