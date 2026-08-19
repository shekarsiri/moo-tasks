import {
  Goal,
  Task,
  TaskDependency,
  TaskNote,
  Decision,
  StatusHistoryEntry,
  TaskStatus,
  GoalStatus,
  DecisionStatus,
} from '../../domain/types.js';

export interface IGoalRepository {
  create(goal: Goal): Goal;
  findById(id: string): Goal | null;
  list(projectPath: string, status?: GoalStatus): Goal[];
  update(goal: Goal): Goal;
  delete(id: string): boolean;
  countOpenTasks(goalId: string): number;
}

export interface TaskFilter {
  goalId?: string;
  parentId?: string | null;
  status?: TaskStatus;
  statuses?: TaskStatus[];
  claimedByAgent?: string;
  isDeferred?: boolean;
  isArchived?: boolean;
  searchQuery?: string;
  limit?: number;
}

export interface ITaskRepository {
  create(task: Task): Task;
  createBatch(tasks: Task[]): Task[];
  findById(id: string): Task | null;
  findByIdempotencyKey(key: string): Task | null;
  list(filter?: TaskFilter): Task[];
  listByGoalId(goalId: string): Task[];
  listSubtasks(parentId: string): Task[];
  listOrphanTasks(): Task[];
  update(task: Task): Task;
  updateBatch(tasks: Task[]): void;
  delete(id: string): boolean;
  
  // Dependencies
  addDependency(taskId: string, dependsOnTaskId: string): void;
  removeDependency(taskId: string, dependsOnTaskId: string): void;
  getDependencies(taskId: string): string[];
  getDependents(taskId: string): string[];
  getAllDependencies(): TaskDependency[];
  
  // Reordering
  updateOrderIndices(updates: { id: string; orderIndex: number }[]): void;
}

export interface IDecisionRepository {
  create(decision: Decision): Decision;
  findById(id: string): Decision | null;
  list(projectPath?: string, status?: DecisionStatus, tag?: string): Decision[];
  update(decision: Decision): Decision;
  delete(id: string): boolean;
}

export interface INoteRepository {
  create(note: TaskNote): TaskNote;
  listByTaskId(taskId: string): TaskNote[];
  listRecent(limit?: number): TaskNote[];
}

export interface IStatusHistoryRepository {
  create(entry: StatusHistoryEntry): StatusHistoryEntry;
  listByTaskId(taskId: string): StatusHistoryEntry[];
  findLatestByTaskId(taskId: string): StatusHistoryEntry | null;
  findPreviousState(taskId: string): StatusHistoryEntry | null;
}
