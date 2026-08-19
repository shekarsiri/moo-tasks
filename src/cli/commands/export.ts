import fs from 'fs';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export async function exportCommand(options: {
  format?: 'markdown' | 'json' | 'text';
  out?: string;
  projectPath?: string;
}) {
  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });
  const format = options.format || 'markdown';

  const output = container.housekeepingService.exportProject(root, format);

  if (options.out) {
    fs.writeFileSync(options.out, output, 'utf-8');
    console.log(`${picocolors.green('✔')} Exported project to ${picocolors.cyan(options.out)} (${format})`);
  } else {
    console.log(output);
  }
}
