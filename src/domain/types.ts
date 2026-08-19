export type TaskStatus =
  | 'todo'
  | 'doing'
  | 'blocked-on-dependency'
  | 'waiting-on-human'
  | 'done'
  | 'dropped';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type GoalStatus = 'active' | 'completed' | 'dropped';

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';

export type NoteType =
  | 'general'
  | 'attempt_failure'
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
}

export interface GitContext {
  branch?: string;
  commitHash?: string;
  isDirty?: boolean;
  modifiedFiles?: string[];
}

export interface Goal {
  id: string;
  title: string;
  verbatimPrompt: string;
  status: GoalStatus;
  maxOpenTasksCap: number;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  droppedReason?: string;
}

export interface Task {
  id: string;
  goalId?: string;
  parentId?: string; // One level of subtasks only
  title: string;
  description?: string;
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

  // Blocking details
  blockedReason?: string;
  humanQuestion?: string;
  humanQuestionType?: 'clarification' | 'approval' | 'credential' | 'decision';
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
}

export interface SessionResumeSummary {
  abandonedDoingTasks: Task[];
  waitingOnHumanTasks: Task[];
  unblockedReadyTasks: Task[];
  settledDecisions: Decision[];
  activeGoals: Goal[];
  orphanTasks: Task[];
}
