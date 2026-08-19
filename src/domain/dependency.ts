import { DependencyCycleError } from './errors.js';
import { Task, TaskDependency } from './types.js';

export class DependencyGraph {
  /**
   * Checks if adding dependencies from taskId -> dependsOnTaskIds would create a cycle.
   * Throws DependencyCycleError if a cycle is detected.
   */
  static validateNoCycles(
    existingDependencies: TaskDependency[],
    newTaskId: string,
    newDependsOnIds: string[]
  ): void {
    const adjList = new Map<string, Set<string>>();

    // Build adjacency list: node -> set of nodes it depends on
    for (const dep of existingDependencies) {
      if (!adjList.has(dep.taskId)) {
        adjList.set(dep.taskId, new Set());
      }
      adjList.get(dep.taskId)!.add(dep.dependsOnTaskId);
    }

    // Add candidate edges
    if (!adjList.has(newTaskId)) {
      adjList.set(newTaskId, new Set());
    }
    for (const depId of newDependsOnIds) {
      adjList.get(newTaskId)!.add(depId);
    }

    // Run DFS cycle detection
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): boolean {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = adjList.get(node);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            if (dfs(neighbor)) return true;
          } else if (recStack.has(neighbor)) {
            path.push(neighbor);
            return true;
          }
        }
      }

      recStack.delete(node);
      path.pop();
      return false;
    }

    for (const node of adjList.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) {
          throw new DependencyCycleError(path);
        }
      }
    }
  }

  /**
   * Determine if a task is unblocked (all direct blockers are in 'done' state).
   */
  static isTaskUnblocked(
    taskId: string,
    dependencies: TaskDependency[],
    taskMap: Map<string, Task>
  ): boolean {
    const directBlockerIds = dependencies
      .filter((d) => d.taskId === taskId)
      .map((d) => d.dependsOnTaskId);

    for (const blockerId of directBlockerIds) {
      const blocker = taskMap.get(blockerId);
      if (!blocker || blocker.status !== 'done') {
        return false;
      }
    }
    return true;
  }
}
