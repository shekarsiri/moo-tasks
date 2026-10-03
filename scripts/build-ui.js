import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

/**
 * Builds the board's static assets. Third-party scripts are copied from node_modules into
 * src/ui/vendor and Tailwind is compiled there, so the board loads nothing from a CDN and works
 * offline; then src/ui is copied to dist/ui. `--vendor-only` stops after the vendor step (dev).
 */
const require = createRequire(import.meta.url);
const srcUi = path.resolve('src/ui');
const vendorDir = path.join(srcUi, 'vendor');
const distUi = path.resolve('dist/ui');

const VENDOR_FILES = {
  'lucide.min.js': 'lucide/dist/umd/lucide.min.js',
  'marked.min.js': 'marked/marked.min.js',
  'purify.min.js': 'dompurify/dist/purify.min.js',
  'turndown.js': 'turndown/dist/turndown.js',
  'turndown-plugin-gfm.js': 'turndown-plugin-gfm/dist/turndown-plugin-gfm.js',
};

fs.mkdirSync(vendorDir, { recursive: true });
for (const [name, modulePath] of Object.entries(VENDOR_FILES)) {
  fs.copyFileSync(require.resolve(modulePath), path.join(vendorDir, name));
}

const input = path.join(vendorDir, '.tailwind-input.css');
fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(
  process.execPath,
  [require.resolve('tailwindcss/lib/cli.js'), '-c', 'tailwind.config.cjs', '-i', input, '-o', path.join(vendorDir, 'tailwind.css'), '--minify'],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);
fs.rmSync(input);
console.log(`Vendored ${Object.keys(VENDOR_FILES).length} scripts and compiled Tailwind into src/ui/vendor`);

if (!process.argv.includes('--vendor-only')) {
  fs.rmSync(distUi, { recursive: true, force: true });
  fs.cpSync(srcUi, distUi, { recursive: true });
  console.log('Copied UI static assets to dist/ui');
}
