import fs from 'fs';
import path from 'path';

export interface DetectedVerifyCommand {
  command: string;
  /** The file the command was inferred from, shown to the user before it is set. */
  source: string;
}

/** What `npm init` writes when a package has no tests. */
const NPM_PLACEHOLDER_TEST = /no test specified/i;

const read = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
};

/**
 * The command a project most likely uses to run its tests, inferred from its manifests, for
 * `moo init` to offer as the workspace verify command. Returns null when nothing is clear.
 */
export function detectVerifyCommand(root: string): DetectedVerifyCommand | null {
  const at = (name: string) => path.join(root, name);
  const has = (name: string) => fs.existsSync(at(name));

  const pkg = read(at('package.json'));
  if (pkg) {
    try {
      const test = JSON.parse(pkg)?.scripts?.test;
      if (typeof test === 'string' && test.trim() && !NPM_PLACEHOLDER_TEST.test(test)) {
        const runner = has('pnpm-lock.yaml')
          ? 'pnpm test'
          : has('yarn.lock')
            ? 'yarn test'
            : has('bun.lockb') || has('bun.lock')
              ? 'bun run test'
              : 'npm test';
        return { command: runner, source: 'package.json' };
      }
    } catch {
      // Unparseable package.json: try the other manifests
    }
  }
  if (has('go.mod')) return { command: 'go test ./...', source: 'go.mod' };
  if (has('Cargo.toml')) return { command: 'cargo test', source: 'Cargo.toml' };
  if (has('pytest.ini') || /\[tool\.pytest|pytest/.test(read(at('pyproject.toml')) || '') || /\[tool:pytest\]/.test(read(at('setup.cfg')) || '')) {
    return { command: 'pytest', source: has('pytest.ini') ? 'pytest.ini' : has('pyproject.toml') ? 'pyproject.toml' : 'setup.cfg' };
  }
  const pubspec = read(at('pubspec.yaml'));
  if (pubspec) {
    return { command: /sdk:\s*flutter/.test(pubspec) ? 'flutter test' : 'dart test', source: 'pubspec.yaml' };
  }
  for (const makefile of ['Makefile', 'makefile', 'GNUmakefile']) {
    if (/^test\s*:/m.test(read(at(makefile)) || '')) return { command: 'make test', source: makefile };
  }
  return null;
}
