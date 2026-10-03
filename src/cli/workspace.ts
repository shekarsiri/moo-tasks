import picocolors from 'picocolors';
import { Workspace } from '../domain/types.js';
import { NoWorkspaceError } from '../domain/errors.js';
import { createServiceContainer, ServiceContainer } from '../services/index.js';

/**
 * The container and workspace for a command that reads or works inside a project. Git checkouts and
 * Moo-marked directories are registered on first use; anywhere else the command stops with a hint
 * instead of registering an arbitrary directory (a home folder, `/`, a temp dir).
 */
export function openCliWorkspace(projectPath?: string): { container: ServiceContainer; workspace: Workspace } {
  const container = createServiceContainer({ projectPath: projectPath || process.cwd(), register: 'if-project' });
  if (!container.activeWorkspace) {
    console.error(`${picocolors.yellow('!')} ${new NoWorkspaceError(container.projectPath).message}`);
    console.error(`  Run ${picocolors.cyan('moo init')} in the project root to start tracking work there.`);
    process.exit(1);
  }
  return { container, workspace: container.activeWorkspace };
}
