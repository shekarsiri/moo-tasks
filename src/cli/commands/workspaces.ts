import path from 'path';
import picocolors from 'picocolors';
import { createServiceContainer } from '../../services/index.js';
import { DatabaseManager } from '../../infrastructure/db/database.js';

export async function workspacesCommand(options: { json?: boolean; projectPath?: string }) {
  const container = createServiceContainer({ projectPath: options.projectPath });
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
      isActive: ws.id === container.activeWorkspace.id,
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
  const container = createServiceContainer();
  const resolved = path.resolve(dirPath || process.cwd());
  const ws = container.workspaceService.getOrCreateWorkspace(resolved, options.name);

  console.log(`${picocolors.green('✔')} Registered workspace: ${picocolors.bold(picocolors.cyan(ws.name))} (${ws.id})`);
  console.log(`  Path: ${ws.rootPath}`);
}

export async function renameWorkspaceCommand(idOrName: string, newName: string) {
  const container = createServiceContainer();
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
  const container = createServiceContainer();
  const ws = container.workspaceService.getWorkspace(idOrName);
  if (!ws) {
    console.error(picocolors.red(`Error: Workspace "${idOrName}" not found.`));
    process.exit(1);
  }

  const updated = container.workspaceService.updateWorkspace(ws.id, { gitRemote: gitRemote.trim() });
  console.log(`${picocolors.green('✔')} Updated workspace git remote: ${picocolors.cyan(updated.gitRemote || '(none)')}`);
}

export async function removeWorkspaceCommand(idOrName: string) {
  const container = createServiceContainer();
  const ws = container.workspaceService.getWorkspace(idOrName);
  if (!ws) {
    console.error(picocolors.red(`Error: Workspace "${idOrName}" not found.`));
    process.exit(1);
  }

  container.workspaceService.deleteWorkspace(ws.id);
  console.log(`${picocolors.green('✔')} Removed workspace: ${picocolors.cyan(ws.name)} (${ws.id})`);
}
