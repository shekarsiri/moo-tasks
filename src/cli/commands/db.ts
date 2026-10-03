import fs from 'fs';
import picocolors from 'picocolors';
import { DatabaseManager } from '../../infrastructure/db/database.js';
import { DatabaseMigrator, backupDatabase, compactDatabase, slimGitHistory } from '../../infrastructure/db/migrations.js';

const sizeOf = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Backs up the database, slims stored git snapshots and rebuilds the file to return the space. */
export async function dbCompactCommand(options: { backup?: boolean }) {
  const db = DatabaseManager.getDatabase({});
  const dbPath = DatabaseManager.getActiveDbPath()!;
  const total = () => sizeOf(dbPath) + sizeOf(`${dbPath}-wal`);
  const before = total();
  DatabaseMigrator.runMigrations(db);

  if (options.backup !== false) {
    const backup = backupDatabase(db, 'pre-compact');
    if (!backup) {
      console.error(picocolors.red(`Could not back up ${dbPath}; nothing was changed. Use --no-backup to compact anyway.`));
      process.exit(1);
    }
    console.log(`${picocolors.green('✔')} Backup: ${picocolors.cyan(backup)}`);
  }

  const slimmed = slimGitHistory(db);
  const compacted = compactDatabase(db);
  console.log(`${picocolors.green('✔')} Slimmed git snapshots on ${slimmed.notes} note(s) and ${slimmed.tasks} task(s)`);
  if (!compacted) {
    console.log(`${picocolors.yellow('!')} Compaction skipped: another process is writing. Stop the board and agents, then run it again.`);
  }
  console.log(`${picocolors.green('✔')} ${dbPath}: ${mb(before)} → ${mb(total())}`);
}
