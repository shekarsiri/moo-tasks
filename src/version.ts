import fs from 'fs';

/** The package version, read from package.json so the CLI and MCP server never drift from it. */
export const VERSION: string = (() => {
  try {
    // src/version.ts and dist/version.js both sit one level below the package root
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
