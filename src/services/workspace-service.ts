import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { Workspace } from '../domain/types.js';
import { IWorkspaceRepository } from '../infrastructure/repositories/interfaces.js';
import { DatabaseManager, realpathOrResolve } from '../infrastructure/db/database.js';
import { GitContextService } from '../infrastructure/git/git-context.js';

/**
 * When a directory may be registered as a new workspace: `always` (explicit commands such as
 * `moo init`), `if-project` (git checkouts and Moo-marked directories only), or `never` (hooks).
 */
export type WorkspaceRegistration = 'always' | 'if-project' | 'never';

export interface WorkspaceLocation {
  /** Where git and the verify command run: the checkout itself, which may be a linked worktree. */
  checkoutRoot: string;
  /** The main repository root; a new workspace is registered under it, so worktrees share one. */
  repoRoot: string;
  isProject: boolean;
  workspace: Workspace | null;
}

export class WorkspaceService {
  constructor(private workspaceRepo: IWorkspaceRepository) {}

  /**
   * The workspace a directory belongs to. Registrations win nearest first (a sub-package, the
   * checkout, then the main repository of a worktree); paths are compared after resolving symlinks.
   * Outside a project, registered ancestors still count, except the home and filesystem roots.
   */
  resolveLocation(startDir: string, register: WorkspaceRegistration = 'never'): WorkspaceLocation {
    const start = path.resolve(startDir);
    const project = DatabaseManager.detectProject(start);
    const checkoutRoot = project.root;
    const roots = project.isGit ? GitContextService.repoRoots(checkoutRoot) : null;
    const repoRoot = roots?.mainRoot && roots.mainRoot !== roots.toplevel ? roots.mainRoot : checkoutRoot;

    const candidates: string[] = [];
    const home = path.resolve(os.homedir());
    for (let dir = start; ; dir = path.dirname(dir)) {
      const isUmbrella = dir !== start && (dir === home || dir === path.parse(dir).root);
      if (!isUmbrella) candidates.push(dir);
      if (dir === checkoutRoot && project.isProject) break;
      if (dir === path.dirname(dir)) break;
    }
    if (repoRoot !== checkoutRoot) candidates.push(repoRoot);

    const byRealPath = new Map<string, Workspace>();
    for (const ws of this.workspaceRepo.list()) byRealPath.set(realpathOrResolve(ws.rootPath), ws);
    for (const dir of candidates) {
      const ws = this.workspaceRepo.findByPath(dir) || byRealPath.get(realpathOrResolve(dir));
      if (ws) return { checkoutRoot, repoRoot, isProject: project.isProject, workspace: ws };
    }

    const mayRegister = register === 'always' || (register === 'if-project' && project.isProject);
    const workspace = mayRegister ? this.getOrCreateWorkspace(project.isProject ? repoRoot : start) : null;
    return { checkoutRoot: project.isProject ? checkoutRoot : start, repoRoot, isProject: project.isProject, workspace };
  }

  /**
   * The directory inside this checkout that corresponds to a workspace root: the workspace root
   * itself, or its counterpart in a linked worktree (/repo/pkg seen from worktree /wt is /wt/pkg).
   */
  static checkoutPathFor(location: Pick<WorkspaceLocation, 'checkoutRoot' | 'repoRoot'>, workspace: Workspace): string {
    const root = path.resolve(workspace.rootPath);
    if (location.checkoutRoot === location.repoRoot) return root;
    const real = realpathOrResolve(root);
    const within = (base: string): string | null => {
      const rel = path.relative(realpathOrResolve(base), real);
      return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
    };
    // Registered under the worktree itself (or inside it): already a path in this checkout.
    if (within(location.checkoutRoot) !== null) return root;
    const rel = within(location.repoRoot);
    return rel === null ? root : path.join(location.checkoutRoot, rel);
  }

  /**
   * Discovers git remote URL for a directory if it is a git repo.
   */
  private getGitRemote(dir: string): string | undefined {
    try {
      const url = execSync('git remote get-url origin', {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
      }).trim();
      return url || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves or registers a workspace for the given project path.
   */
  getOrCreateWorkspace(projectPath: string, name?: string, gitRemote?: string): Workspace {
    const rootPath = path.resolve(projectPath);
    const existing = this.workspaceRepo.findByPath(rootPath);
    if (existing) {
      // Update name or gitRemote if explicitly provided
      if ((name && name !== existing.name) || (gitRemote && gitRemote !== existing.gitRemote)) {
        return this.workspaceRepo.update({
          ...existing,
          name: name || existing.name,
          gitRemote: gitRemote || existing.gitRemote || this.getGitRemote(rootPath),
          updatedAt: new Date().toISOString(),
        });
      }
      return existing;
    }

    const detectedRemote = gitRemote || this.getGitRemote(rootPath);
    const workspaceName = name || path.basename(rootPath) || 'workspace';
    const id = `ws-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    const workspace: Workspace = {
      id,
      name: workspaceName,
      rootPath,
      gitRemote: detectedRemote,
      createdAt: now,
      updatedAt: now,
    };

    return this.workspaceRepo.create(workspace);
  }

  listWorkspaces(): Workspace[] {
    return this.workspaceRepo.list();
  }

  listEmptyWorkspaces(): Workspace[] {
    return this.workspaceRepo.listEmpty();
  }

  getWorkspaceById(id: string): Workspace | null {
    return this.workspaceRepo.findById(id);
  }

  getWorkspaceByPath(rootPath: string): Workspace | null {
    return this.workspaceRepo.findByPath(path.resolve(rootPath));
  }

  getWorkspaceByName(name: string): Workspace | null {
    return this.workspaceRepo.findByName(name);
  }

  /**
   * Resolves a workspace by either its ID, canonical path, or name.
   */
  getWorkspace(idOrPathOrName: string): Workspace | null {
    return (
      this.workspaceRepo.findById(idOrPathOrName) ||
      this.workspaceRepo.findByPath(path.resolve(idOrPathOrName)) ||
      this.workspaceRepo.findByName(idOrPathOrName)
    );
  }

  updateWorkspace(idOrPathOrName: string, updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>): Workspace {
    const existing = this.getWorkspace(idOrPathOrName);
    if (!existing) {
      throw new Error(`Workspace "${idOrPathOrName}" not found`);
    }

    const updated: Workspace = {
      ...existing,
      name: updates.name ? updates.name.trim() : existing.name,
      rootPath: updates.rootPath ? path.resolve(updates.rootPath) : existing.rootPath,
      gitRemote: updates.gitRemote !== undefined ? updates.gitRemote.trim() || undefined : existing.gitRemote,
      verifyCommand: updates.verifyCommand !== undefined ? updates.verifyCommand.trim() || undefined : existing.verifyCommand,
      verifyTimeoutSeconds:
        updates.verifyTimeoutSeconds !== undefined ? updates.verifyTimeoutSeconds || undefined : existing.verifyTimeoutSeconds,
      updatedAt: new Date().toISOString(),
    };

    return this.workspaceRepo.update(updated);
  }

  deleteWorkspace(idOrPathOrName: string): boolean {
    const existing = this.getWorkspace(idOrPathOrName);
    if (!existing) {
      return false;
    }
    return this.workspaceRepo.delete(existing.id);
  }
}
