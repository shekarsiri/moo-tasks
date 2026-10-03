import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from './db/database.js';

/**
 * Claude Code and git hooks run one stable file, `~/.moo/bin/moo-hook`, instead of embedding the
 * paths of the Node binary and the CLI. Version managers (mise, nvm, asdf) keep Node in versioned
 * directories, so an embedded path breaks on the next Node upgrade; the shim is rewritten to the
 * running install whenever moo starts (MCP server, init, install, doctor).
 */
export function hookShimPath(): string {
  return path.join(DatabaseManager.getGlobalMooDir(), 'bin', 'moo-hook');
}

const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function hookShimScript(nodePath: string, cliPath: string): string {
  return [
    '#!/bin/sh',
    '# moo-tasks hook shim: Claude Code and git hooks run this file so a Node or moo upgrade never',
    '# breaks them. moo rewrites it to the running install; edits here are overwritten.',
    `NODE=${shQuote(nodePath)}`,
    `CLI=${shQuote(cliPath)}`,
    'if [ -x "$NODE" ] && [ -f "$CLI" ]; then exec "$NODE" "$CLI" hook "$@"; fi',
    'if command -v moo-tasks >/dev/null 2>&1; then exec moo-tasks hook "$@"; fi',
    'if command -v moo >/dev/null 2>&1; then exec moo hook "$@"; fi',
    '# No install found: never block an edit or a commit.',
    'exit 0',
    '',
  ].join('\n');
}

/** The built CLI entry of this install, or null when running from source (tsx), which must not own the shim. */
export function installedCliPath(): string | null {
  const cli = fileURLToPath(new URL('../cli/index.js', import.meta.url));
  return fs.existsSync(cli) ? cli : null;
}

/**
 * Writes the shim, or points it at this install when it targets another one. Returns its path, or
 * null when it cannot be written; it never throws, because callers include the MCP server startup.
 */
export function ensureHookShim(nodePath: string = process.execPath, cliPath: string | null = installedCliPath()): string | null {
  try {
    const file = hookShimPath();
    if (!cliPath) return fs.existsSync(file) ? file : null;
    const script = hookShimScript(nodePath, cliPath);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === script) return file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, script, { mode: 0o755 });
    fs.renameSync(tmp, file);
    return file;
  } catch {
    return null;
  }
}

/** The node and CLI paths a shim points at, for `moo doctor`. */
export function readHookShim(file: string = hookShimPath()): { node: string; cli: string } | null {
  try {
    const text = fs.readFileSync(file, 'utf-8');
    const value = (name: string) => {
      const m = text.match(new RegExp(`^${name}='((?:[^']|'\\\\'')*)'$`, 'm'));
      return m ? m[1].replace(/'\\''/g, "'") : '';
    };
    return { node: value('NODE'), cli: value('CLI') };
  } catch {
    return null;
  }
}

/** Re-points an installed shim at this install (MCP startup); creates nothing when hooks were never installed. */
export function refreshHookShim(): void {
  try {
    if (fs.existsSync(hookShimPath())) ensureHookShim();
  } catch {
    // Never fail a server start over the shim
  }
}
