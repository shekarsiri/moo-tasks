import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';

export async function workspacesCommand(options: { json?: boolean; projectPath?: string }) {
  const container = createServiceContainer({ projectPath: options.projectPath, register: 'never' });
  const workspaces = container.workspaceService.listWorkspaces();

  const details = workspaces.map((ws) => {
    const goals = container.goalRepo.list(undefined, undefined, ws.id);
    const tasks = container.taskRepo.list({ workspaceId: ws.id });
    const openTasks = tasks.filter(
      (t) => ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(t.status) && !t.isArchived
    );
    return {
      id: ws.id,
      name: ws.name,
      rootPath: ws.rootPath,
      gitRemote: ws.gitRemote || '-',
      activeGoals: goals.filter((g) => g.status === 'active').length,
      totalGoals: goals.length,
      openTasks: openTasks.length,
      totalTasks: tasks.length,
      isActive: ws.id === container.activeWorkspace?.id,
      createdAt: ws.createdAt,
    };
  });

  if (options.json) {
    console.log(JSON.stringify({ activeWorkspace: container.activeWorkspace, workspaces: details }, null, 2));
    return;
  }

  console.log(`\n${picocolors.bold(picocolors.cyan('🐮 Moo Tasks Global Workspaces'))}`);
  console.log(`Global Database: ${picocolors.dim(DatabaseManager.resolveGlobalDbPath())}\n`);

  if (details.length === 0) {
    console.log(picocolors.gray('No workspaces registered yet. Run `moo init` in your project to register.'));
    return;
  }

  for (const ws of details) {
    const prefix = ws.isActive ? picocolors.green('● (Active) ') : picocolors.gray('○ ');
    console.log(`${prefix}${picocolors.bold(ws.name)} ${picocolors.dim(`[${ws.id}]`)}`);
    console.log(`  ${picocolors.gray('Path:')}   ${ws.rootPath}`);
    console.log(
      `  ${picocolors.gray('Stats:')}  ${picocolors.cyan(String(ws.openTasks))} open tasks / ${ws.totalTasks} total | ${ws.activeGoals} active goals`
    );
    if (ws.gitRemote && ws.gitRemote !== '-') {
      console.log(`  ${picocolors.gray('Git:')}    ${picocolors.dim(ws.gitRemote)}`);
    }
    console.log('');
  }
}

export async function addWorkspaceCommand(dirPath: string, options: { name?: string }) {
  const container = createServiceContainer({ register: 'never' });
  const resolved = path.resolve(dirPath || process.cwd());
  const ws = container.workspaceService.getOrCreateWorkspace(resolved, options.name);

  console.log(`${picocolors.green('✔')} Registered workspace: ${picocolors.bold(picocolors.cyan(ws.name))} (${ws.id})`);
  console.log(`  Path: ${ws.rootPath}`);
}

export async function renameWorkspaceCommand(idOrName: string, newName: string) {
  const container = createServiceContainer({ register: 'never' });
  const ws = container.workspaceService.getWorkspace(idOrName);
  if (!ws) {
    console.error(picocolors.red(`Error: Workspace "${idOrName}" not found.`));
    process.exit(1);
  }

  if (!newName || !newName.trim()) {
    console.error(picocolors.red(`Error: New display name cannot be empty.`));
    process.exit(1);
  }

  const updated = container.workspaceService.updateWorkspace(ws.id, { name: newName.trim() });
  console.log(`${picocolors.green('✔')} Renamed workspace display name: ${picocolors.bold(picocolors.cyan(updated.name))} (${ws.id})`);
}

export async function setRemoteWorkspaceCommand(idOrName: string, gitRemote: string) {
  const container = createServiceContainer({ register: 'never' });
  const ws = container.workspaceService.getWorkspace(idOrName);
  if (!ws) {
    console.error(picocolors.red(`Error: Workspace "${idOrName}" not found.`));
    process.exit(1);
  }

  const updated = container.workspaceService.updateWorkspace(ws.id, { gitRemote: gitRemote.trim() });
  console.log(`${picocolors.green('✔')} Updated workspace git remote: ${picocolors.cyan(updated.gitRemote || '(none)')}`);
}

export async function removeWorkspaceCommand(idOrName: string) {
  const container = createServiceContainer({ register: 'never' });
  const ws = container.workspaceService.getWorkspace(idOrName);
  if (!ws) {
    console.error(picocolors.red(`Error: Workspace "${idOrName}" not found.`));
    process.exit(1);
  }

  container.workspaceService.deleteWorkspace(ws.id);
  console.log(`${picocolors.green('✔')} Removed workspace: ${picocolors.cyan(ws.name)} (${ws.id})`);
}

/** Unregisters workspaces nothing was ever tracked in; lists them first, deletes only with --yes. */
export async function pruneWorkspacesCommand(options: { yes?: boolean }) {
  const container = createServiceContainer({ register: 'never' });
  const empty = container.workspaceService.listEmptyWorkspaces();
  if (empty.length === 0) {
    console.log(`${picocolors.green('✔')} No empty workspaces.`);
    return;
  }
  console.log(`\n${picocolors.bold(`${empty.length} workspace(s) with no goals, tasks or decisions:`)}`);
  for (const ws of empty) console.log(`  - ${picocolors.cyan(ws.name)} ${picocolors.dim(`(${ws.id})`)} ${ws.rootPath}`);
  if (!options.yes) {
    console.log(`\nRun ${picocolors.yellow('moo ws:prune --yes')} to remove them. A project is registered again the next time Moo is used in it.\n`);
    return;
  }
  for (const ws of empty) container.workspaceService.deleteWorkspace(ws.id);
  console.log(`\n${picocolors.green('✔')} Removed ${empty.length} empty workspace(s).\n`);
}

/** Moves a goal (and its tasks) that was filed under the wrong project to another workspace. */
export async function moveGoalCommand(goalId: string, workspace: string) {
  const container = createServiceContainer({ register: 'never' });
  const target = container.workspaceService.getWorkspace(workspace);
  if (!target) {
    console.error(picocolors.red(`Error: Workspace "${workspace}" not found. List them with moo ws.`));
    process.exit(1);
  }
  try {
    const result = container.goalService.moveGoal(goalId, target.id);
    console.log(
      `${picocolors.green('✔')} Moved goal ${picocolors.cyan(result.goal.id)} "${result.goal.title}" and ${result.movedTaskCount} task(s) to ${picocolors.bold(target.name)}.`
    );
    for (const link of result.crossWorkspaceDependencies) {
      console.log(`  ${picocolors.yellow('!')} ${link.taskId} depends on ${link.dependsOnTaskId}, which is in another workspace now.`);
    }
  } catch (err: any) {
    console.error(picocolors.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
