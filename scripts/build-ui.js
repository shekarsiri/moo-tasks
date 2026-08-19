import fs from 'fs';
import path from 'path';

const srcUi = path.resolve('src/ui');
const distUi = path.resolve('dist/ui');

if (fs.existsSync(srcUi)) {
  if (!fs.existsSync(distUi)) {
    fs.mkdirSync(distUi, { recursive: true });
  }
  for (const file of fs.readdirSync(srcUi)) {
    fs.copyFileSync(path.join(srcUi, file), path.join(distUi, file));
  }
  console.log('Copied UI static assets to dist/ui');
}
