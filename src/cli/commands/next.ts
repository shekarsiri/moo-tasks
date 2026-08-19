import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export async function nextCommand(options: { goal?: string; projectPath?: string; json?: boolean }) {
  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });

  const next = container.taskLifecycleService.getNextUnblockedTask(options.goal);

  if (options.json) {
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  if (!next) {
    console.log(`\n${picocolors.yellow('No unblocked tasks available in the ready queue.')}\n`);
    return;
  }

  console.log(`\n${picocolors.bold(picocolors.green('🎯 NEXT READY TASK'))}`);
  console.log(`  ${picocolors.gray('ID:')}        ${picocolors.bold(picocolors.cyan(next.id))}`);
  console.log(`  ${picocolors.gray('Title:')}     ${picocolors.white(next.title)}`);
  console.log(`  ${picocolors.gray('Priority:')}  ${picocolors.magenta(next.priority)}`);
  if (next.goalId) console.log(`  ${picocolors.gray('Goal:')}      ${picocolors.cyan(next.goalId)}`);
  if (next.declaredFiles && next.declaredFiles.length > 0) {
    console.log(`  ${picocolors.gray('Files:')}     ${picocolors.yellow(next.declaredFiles.join(', '))}`);
  }
  console.log(`  ${picocolors.gray('Criteria:')}  ${picocolors.white(next.acceptanceCriteria)}`);
  console.log('');
}
