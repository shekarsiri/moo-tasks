import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';

export async function listCommand(options: {
  goal?: string;
  status?: string;
  priority?: string;
  type?: string;
  tag?: string;
  agent?: string;
  deferred?: boolean;
  projectPath?: string;
  json?: boolean;
}) {
  const root = options.projectPath ? options.projectPath : process.cwd();
  const container = createServiceContainer({ projectPath: root });

  const filter: any = { isArchived: false };
  if (options.goal) filter.goalId = options.goal;
  if (options.status) filter.status = options.status;
  if (options.priority) filter.priority = options.priority;
  if (options.type) filter.type = options.type;
  if (options.tag) filter.tag = options.tag;
  if (options.agent) filter.claimedByAgent = options.agent;
  if (options.deferred !== undefined) filter.isDeferred = options.deferred;

  const tasks = container.taskRepo.list(filter);

  if (options.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  console.log(`\n${picocolors.bold(picocolors.blue('🐮 MOO TASKS'))} (${tasks.length} total)\n`);

  if (tasks.length === 0) {
    console.log(picocolors.gray('No tasks match the filter.'));
    console.log('');
    return;
  }

  const statusColors: Record<string, (s: string) => string> = {
    todo: picocolors.gray,
    doing: picocolors.yellow,
    'blocked-on-dependency': picocolors.red,
    'waiting-on-human': picocolors.magenta,
    done: picocolors.green,
    dropped: picocolors.dim,
  };

  const typeColors: Record<string, (s: string) => string> = {
    feature: picocolors.cyan,
    bug: picocolors.red,
    refactor: picocolors.yellow,
    test: picocolors.green,
    docs: picocolors.blue,
    chore: picocolors.gray,
    spike: picocolors.magenta,
    security: picocolors.red,
  };

  for (const t of tasks) {
    const colorFn = statusColors[t.status] || picocolors.white;
    const statusTag = `[${colorFn(t.status.toUpperCase())}]`;
    const typeColorFn = typeColors[t.type] || picocolors.cyan;
    const typeTag = `[${typeColorFn(t.type || 'feature')}]`;
    const priorityTag = `(${picocolors.dim(t.priority)})`;
    const tagsTag = t.tags && t.tags.length > 0 ? picocolors.blue(`{${t.tags.join(', ')}}`) : '';
    const goalTag = t.goalId ? picocolors.dim(`[Goal: ${t.goalId}]`) : '';
    const agentTag = t.claimedByAgent ? picocolors.magenta(`@${t.claimedByAgent}`) : '';

    console.log(`  ${statusTag} ${typeTag} ${picocolors.bold(t.id)} ${priorityTag} ${t.title} ${tagsTag} ${agentTag} ${goalTag}`);
    if (t.acceptanceCriteria) {
      console.log(`    ${picocolors.gray('Criteria:')} ${picocolors.dim(t.acceptanceCriteria.slice(0, 90))}`);
    }
  }
  console.log('');
}
