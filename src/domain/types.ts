import type { CriterionResult } from './criteria.js';

export type TaskStatus =
  | 'todo'
  | 'doing'
  | 'blocked-on-dependency'
  | 'waiting-on-human'
  | 'done'
  | 'dropped';

export type TaskType =
  | 'feature'
  | 'bug'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'chore'
  | 'spike'
  | 'security';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type GoalStatus = 'active' | 'completed' | 'dropped';

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';

export type NoteType =
  | 'general'
  | 'attempt_failure'
  | 'attempt_log'
  | 'checkpoint'
  | 'block_reason'
  | 'drop_reason'
  | 'reopen_reason'
  | 'rejection_reason'
  | 'handoff_note'
  | 'verification_note'
  | 'discovered_work';

export type AuthorType = 'agent' | 'human' | 'system';

export type VerificationState = 'unverified' | 'agent_completed' | 'verified_done' | 'rejected';

export interface TaskEvidence {
  commandsRun?: string[];
  outputSnippet?: string;
  filesModified?: string[];
  testProof?: string;
  notes?: string;
  gitContext?: GitContext;
  /** One answer per acceptance-criteria checklist item; unmet ones are deviations. */
  criteria?: CriterionResult[];
  /** Result of the workspace verify command, run by Moo itself (never supplied by agents). */
  verification?: VerificationRun;
}

export interface VerificationRun {
  command: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  outputTail: string;
  ranAt: string;
  timedOut?: boolean;
  /** Set when an agent completed despite a failing run. */
  overrideReason?: string;
}

export interface GitContext {
  branch?: string;
  commitHash?: string;
  commitSubject?: string;
  diffSummary?: string;
  isDirty?: boolean;
  modifiedFiles?: string[];
}

export interface GitBaseline {
  commitHash?: string;
  /** Files already dirty when the task was claimed, with their blob hash at that moment. */
  dirtyFileHashes: Record<string, string>;
  capturedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  gitRemote?: string;
  /** Shell command Moo runs when a task completes (e.g. `npm test`); set by humans only. */
  verifyCommand?: string;
  verifyTimeoutSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  workspaceId?: string;
  title: string;
  verbatimPrompt: string;
  description?: string;
  status: GoalStatus;
  maxOpenTasksCap: number;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  droppedReason?: string;
  /** Retrospective written when the goal is completed. */
  summary?: string;
}

export interface Task {
  id: string;
  workspaceId?: string;
  goalId?: string;
  parentId?: string; // One level of subtasks only
  title: string;
  description?: string;
  type: TaskType;
  tags: string[];
  status: TaskStatus;
  priority: TaskPriority;
  orderIndex: number;
  acceptanceCriteria: string;
  
  // Ownership and Concurrency
  claimedByAgent?: string;
  claimedSessionId?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  declaredFiles: string[];
  claimGitBaseline?: GitBaseline;

  // Completion & Proof
  verificationState: VerificationState;
  evidence?: TaskEvidence;
  verifiedBy?: string;
  verifiedAt?: string;
  rejectionReason?: string;

  // Counters & Stall Detection
  attemptCount: number;
  closeCount: number;
  reopenCount: number;
  maxAttemptsAllowed: number;

  /** Agent whose claim the lease monitor released mid-task; the next claim resumes that work. */
  interruptedFrom?: string;
  /** Commits that carry this task's work (from `Moo-Task:` trailers). */
  commits?: string[];

  // Dependencies (predecessors this task blocks on)
  dependsOnTaskIds?: string[];

  // Blocking details
  blockedReason?: string;
  humanQuestion?: string;
  humanQuestionType?: 'clarification' | 'approval' | 'credential' | 'decision';
  humanOptions?: string[];
  humanAnswer?: string;
  humanAnsweredAt?: string;
  humanAnsweredBy?: string;

  // Discovered work
  discoveredFromTaskId?: string;
  isDeferred: boolean;

  // Housekeeping & Idempotency
  idempotencyKey?: string;
  isArchived: boolean;
  droppedReason?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastStateChangeAt: string;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorType: AuthorType;
  authorId: string;
  noteType: NoteType;
  content: string;
  gitContext?: GitContext;
  createdAt: string;
}

export interface Decision {
  id: string;
  workspaceId?: string;
  title: string;
  context: string;
  choice: string;
  rationale: string;
  status: DecisionStatus;
  supersededById?: string;
  tags: string[];
  projectPath: string;
  authorId: string;
  authorType: AuthorType;
  createdAt: string;
  updatedAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  changedBy: string;
  authorType: AuthorType;
  reason?: string;
  timestamp: string;
}

export interface GoalStatusSummary {
  goal: Goal;
  totalTasks: number;
  openTasks: number;
  completedTasks: number;
  droppedTasks: number;
  blockedTasks: number;
  waitingOnHumanTasks: number;
  isFullyCovered: boolean;
  looseEnds: Task[];
  hasReachedCap: boolean;
  quality: GoalQualityMetrics;
}

/** How the goal's work went, from completed tasks. Rates are 0..1, or null with nothing to measure. */
export interface GoalQualityMetrics {
  avgCycleMinutes: number | null;
  totalAttempts: number;
  reopens: number;
  criteriaMetRate: number | null;
  tasksWithDeviations: number;
  verifyPassRate: number | null;
  committedRate: number | null;
  discoveredWork: number;
}

export interface SessionResumeSummary {
  abandonedDoingTasks: Task[];
  waitingOnHumanTasks: Task[];
  unblockedReadyTasks: Task[];
  settledDecisions: Decision[];
  activeGoals: Goal[];
  orphanTasks: Task[];
  /** This agent's own in-progress task. */
  currentTask?: Task;
  /** In-progress tasks whose holder is gone (expired lease or dead process): a previous session's work. */
  interruptedTasks: Task[];
  /** The goal this session is most likely working on, with task progress. */
  focusGoal?: Goal & { progress: { done: number; total: number } };
  goalsReadyToClose: Goal[];
  staleTasks: StaleTask[];
}

export interface StaleTask {
  task: Task;
  reason: string;
}
