import path from 'path';
import { execSync } from 'child_process';
import { Workspace } from '../domain/types.js';
import { IWorkspaceRepository } from '../infrastructure/repositories/interfaces.js';

export class WorkspaceService {
  constructor(private workspaceRepo: IWorkspaceRepository) {}

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
