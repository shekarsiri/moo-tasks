import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export async function statusCommand(options: { projectPath?: string; agent?: string; raw?: boolean }) {
  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });
  const agentId = options.agent;

  const context = container.sessionService.getCompactContext(root, agentId);

  if (options.raw) {
    console.log(context);
    return;
  }

  const summary = container.sessionService.whereDidILeaveOff(root, agentId);

  console.log(`\n${picocolors.bold(picocolors.blue('🐮 MOO TASKS STATUS & CONTEXT OVERVIEW'))}`);
  console.log(`  ${picocolors.gray('Project:')} ${picocolors.yellow(container.projectPath)}\n`);

  // Active Goal
  if (summary.activeGoals.length > 0) {
    const goal = summary.activeGoals[0];
    console.log(`${picocolors.bold(picocolors.cyan('🎯 Active Goal:'))} [${goal.id}] ${goal.title}`);
  } else {
    console.log(`${picocolors.gray('🎯 No active goals.')}`);
  }

  // Claimed In-Flight Task
  if (summary.abandonedDoingTasks.length > 0) {
    console.log(`\n${picocolors.bold(picocolors.yellow('⚡ Claimed In-Flight Tasks (Doing):'))}`);
    summary.abandonedDoingTasks.forEach((t) => {
      console.log(`  - [${picocolors.cyan(t.id)}] (${picocolors.magenta(t.priority)}) ${t.title}`);
      if (t.claimedByAgent) console.log(`    Claimed by: ${picocolors.green(t.claimedByAgent)} (Expires: ${t.leaseExpiresAt || 'N/A'})`);
      if (t.acceptanceCriteria) console.log(`    Criteria: ${picocolors.gray(t.acceptanceCriteria.slice(0, 100))}`);
    });
  }

  // Ready Unblocked Task
  if (summary.unblockedReadyTasks.length > 0) {
    console.log(`\n${picocolors.bold(picocolors.green('📋 Next Ready Unblocked Tasks:'))}`);
    summary.unblockedReadyTasks.slice(0, 3).forEach((t) => {
      console.log(`  - [${picocolors.cyan(t.id)}] (${picocolors.magenta(t.priority)}) ${t.title}`);
    });
  }

  // Waiting on Human
  if (summary.waitingOnHumanTasks.length > 0) {
    console.log(`\n${picocolors.bold(picocolors.red('🙋 Waiting on Human Action:'))}`);
    summary.waitingOnHumanTasks.forEach((t) => {
      console.log(`  - [${picocolors.cyan(t.id)}] ${t.title}`);
      if (t.humanQuestion) console.log(`    Question: ${picocolors.yellow(t.humanQuestion)}`);
    });
  }

  // Settled Decisions
  if (summary.settledDecisions.length > 0) {
    console.log(`\n${picocolors.bold(picocolors.white('🏛️  Settled Architectural Decisions (ADR):'))}`);
    summary.settledDecisions.slice(0, 3).forEach((d) => {
      console.log(`  - ${picocolors.bold(d.title)}: ${picocolors.cyan(d.choice)}`);
    });
  }

  console.log(`\n${picocolors.gray('--- Compact Agent Context Block ---')}\n`);
  console.log(context);
  console.log('');
}
