import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../infrastructure/db/database.js';

/**
 * The board has no login. One random token per machine (`~/.moo/board-token`, readable by its owner
 * only) protects it in two ways:
 * - Served on the LAN, every request from another device needs it (the `--lan` link carries it once;
 *   the board then keeps it in an HttpOnly cookie).
 * - On this machine, reads stay open but writes need it. The board page carries it, so people use
 *   the board as before; an agent cannot verify its own work, answer its own question or change the
 *   verify command with a plain curl call. Agents act through the MCP tools.
 */
export const BOARD_TOKEN_HEADER = 'x-moo-token';
export const BOARD_TOKEN_COOKIE = 'moo_token';

export function boardTokenPath(): string {
  return path.join(DatabaseManager.getGlobalMooDir(), 'board-token');
}

/** Reads the machine's board token, creating it on first use. */
export function boardToken(file: string = boardTokenPath()): string {
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (/^[0-9a-f]{32,}$/.test(existing)) return existing;
  } catch {
    // Not created yet
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return token;
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/, '');
  return a === '::1' || a === 'localhost' || /^127\./.test(a);
}

export function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of (cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** The board page with its token, so the page's own writes are accepted. */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="moo-token" content="${token}">`;
  return html.includes('</head>') ? html.replace('</head>', `  ${meta}\n</head>`) : meta + html;
}
