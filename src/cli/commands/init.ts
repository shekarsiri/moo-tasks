import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export async function initCommand(options: { projectPath?: string }) {
  const root = options.projectPath ? path.resolve(options.projectPath) : process.cwd();
  const mooDir = path.join(root, '.moo');

  if (!fs.existsSync(mooDir)) {
    fs.mkdirSync(mooDir, { recursive: true });
  }

  const container = createServiceContainer({ projectPath: root });

  // Add .moo/tasks.db to .gitignore if not present
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('.moo/tasks.db')) {
      fs.appendFileSync(gitignorePath, '\n# Moo Tasks Database\n.moo/tasks.db\n.moo/tasks.db-wal\n.moo/tasks.db-shm\n');
    }
  }

  console.log(`\n${picocolors.bold(picocolors.green('✔ Initialized Moo Tasks workspace!'))}`);
  console.log(`  ${picocolors.gray('Database:')}  ${picocolors.cyan(path.join(mooDir, 'tasks.db'))}`);
  console.log(`  ${picocolors.gray('Run:')}       ${picocolors.yellow('npx moo-tasks start')} to launch Web UI`);
  console.log(`  ${picocolors.gray('MCP Mode:')}  ${picocolors.yellow('npx moo-tasks mcp')} for agent stdio\n`);
}
