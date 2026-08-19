export class DomainError extends Error {
  constructor(message: string, public code: string = 'DOMAIN_ERROR') {
    super(message);
    this.name = 'DomainError';
  }
}

export class GoalCapExceededError extends DomainError {
  constructor(goalId: string, cap: number) {
    super(`Goal ${goalId} has reached its open tasks cap (${cap}). Agents must execute existing tasks before creating more.`, 'GOAL_CAP_EXCEEDED');
    this.name = 'GoalCapExceededError';
  }
}

export class SubtaskNestingError extends DomainError {
  constructor(taskId: string) {
    super(`Task ${taskId} is already a subtask. Only one level of subtasks is permitted.`, 'SUBTASK_NESTING_LIMIT');
    this.name = 'SubtaskNestingError';
  }
}

export class DependencyCycleError extends DomainError {
  constructor(cyclePath: string[]) {
    super(`Dependency cycle detected: ${cyclePath.join(' -> ')}`, 'DEPENDENCY_CYCLE');
    this.name = 'DependencyCycleError';
  }
}

export class ParentHasOpenSubtasksError extends DomainError {
  constructor(parentId: string, openSubtaskCount: number) {
    super(`Cannot close parent task ${parentId} while ${openSubtaskCount} subtask(s) remain open.`, 'PARENT_OPEN_SUBTASKS');
    this.name = 'ParentHasOpenSubtasksError';
  }
}

export class TaskAlreadyClaimedError extends DomainError {
  constructor(taskId: string, claimedBy: string, leaseExpiresAt?: string) {
    super(`Task ${taskId} is already claimed exclusively by agent '${claimedBy}' (lease expires: ${leaseExpiresAt || 'active'}).`, 'TASK_ALREADY_CLAIMED');
    this.name = 'TaskAlreadyClaimedError';
  }
}

export class AgentConcurrencyLimitError extends DomainError {
  constructor(agentId: string, limit: number) {
    super(`Agent '${agentId}' already holds the maximum number of simultaneous tasks (${limit}). Release or complete one first.`, 'AGENT_CONCURRENCY_LIMIT');
    this.name = 'AgentConcurrencyLimitError';
  }
}

export class MissingEvidenceError extends DomainError {
  constructor(taskId: string) {
    super(`Cannot close task ${taskId} without verifiable evidence (commands run, output snippet, or test proofs).`, 'MISSING_EVIDENCE');
    this.name = 'MissingEvidenceError';
  }
}

export class MandatoryReasonMissingError extends DomainError {
  constructor(action: string) {
    super(`A mandatory reason must be provided for ${action}.`, 'MANDATORY_REASON_MISSING');
    this.name = 'MandatoryReasonMissingError';
  }
}

export class TaskNotFoundError extends DomainError {
  constructor(taskId: string) {
    super(`Task with ID '${taskId}' not found.`, 'TASK_NOT_FOUND');
    this.name = 'TaskNotFoundError';
  }
}

export class GoalNotFoundError extends DomainError {
  constructor(goalId: string) {
    super(`Goal with ID '${goalId}' not found.`, 'GOAL_NOT_FOUND');
    this.name = 'GoalNotFoundError';
  }
}

export class DecisionNotFoundError extends DomainError {
  constructor(decisionId: string) {
    super(`Decision with ID '${decisionId}' not found.`, 'DECISION_NOT_FOUND');
    this.name = 'DecisionNotFoundError';
  }
}
