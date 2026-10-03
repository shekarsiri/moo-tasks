import fs from 'fs';
import picocolors from 'picocolors';
import { openCliWorkspace } from '../workspace.js';

export async function exportCommand(options: {
  format?: 'markdown' | 'json' | 'text';
  out?: string;
  projectPath?: string;
}) {
  const { container, workspace } = openCliWorkspace(options.projectPath);
  const root = container.projectPath;
  const format = options.format || 'markdown';

  const output = container.housekeepingService.exportProject(root, format, workspace.id);

  if (options.out) {
    fs.writeFileSync(options.out, output, 'utf-8');
    console.log(`${picocolors.green('✔')} Exported project to ${picocolors.cyan(options.out)} (${format})`);
  } else {
    console.log(output);
  }
}
