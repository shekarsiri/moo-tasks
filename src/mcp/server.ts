import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ServiceContainer } from '../services/index.js';
import { CreateTaskDTO } from '../services/task-lifecycle-service.js';
import { ClaimTaskResult } from '../services/claim-service.js';
import { DependencyGraph } from '../domain/dependency.js';
import { HumanOnlyActionError, InvalidArgumentsError } from '../domain/errors.js';
import { formatAgentIdentity } from '../domain/lease.js';
import { Decision, Task, TaskEvidence } from '../domain/types.js';
import { GitContextService } from '../infrastructure/git/git-context.js';
import { TOOL_DEFS, ToolDef } from './tool-defs.js';
import { LEGACY_TOOL_DEFS } from './tool-defs-legacy.js';

export interface McpServerOptions {
  /** URL of the web board, surfaced to agents in session context. */
  webUiUrl?: string;
}

type Args = Record<string, any>;

const LEASE_CLEANUP_INTERVAL_MS = 30_000;

// Fields an agent may omit: identity comes from the MCP session.
const IMPLICIT_FIELDS = new Set(['agentId', 'sessionId', 'authorId', 'fromAgentId']);

/** Tools whose taskId argument must not trigger an automatic lease renewal. */
const NO_RENEW_TOOLS = new Set([
  'moo_complete_task',
  'moo_complete_and_claim_next',
  'moo_release_task',
  'moo_handoff_task',
  'moo_drop_task',
  'moo_claim_task',
  'moo_quick_start',
]);

/** Humans answer questions and sign off work in the web board; agents must not do it for them. */
const HUMAN_ONLY_TOOLS = new Set(['moo_verify_task', 'moo_answer_human']);

const RECOVERY: Record<string, { action: string; nextTool?: string }> = {
  TASK_BLOCKED_ON_DEPENDENCY: { action: 'Finish its blockers first, or pick other ready work.', nextTool: 'moo_get_next_task' },
  TASK_WAITING_ON_HUMAN: { action: 'The task is paused on a question for the user. Ask the user, or pick other work.', nextTool: 'moo_get_next_task' },
  GOAL_CAP_EXCEEDED: {
    action: 'Complete or drop open tasks in this goal, raise maxOpenTasksCap, or create the task with isDeferred.',
    nextTool: 'moo_update_goal',
  },
  TASK_ALREADY_CLAIMED: { action: 'Another agent holds a live lease. Work on something else.', nextTool: 'moo_get_next_task' },
  AGENT_CONCURRENCY_LIMIT: {
    action: 'Complete or release your current task first. Parallel sub-agents must each pass their own agentId.',
    nextTool: 'moo_complete_task',
  },
  MISSING_EVIDENCE: { action: 'Pass evidence.testProof or evidence.outputSnippet with real command output.', nextTool: 'moo_complete_task' },
  SUBTASK_NESTING_LIMIT: { action: 'Only one level of subtasks is allowed; create it under the goal instead.', nextTool: 'moo_create_task' },
  DEPENDENCY_CYCLE: { action: 'Remove one of the dependency links forming the cycle.', nextTool: 'moo_update_task' },
  TASK_NOT_FOUND: { action: 'Check the id; list or search tasks in this workspace.', nextTool: 'moo_list_tasks' },
  GOAL_NOT_FOUND: { action: 'Check the id, or omit goalId to use the Ad-hoc goal.', nextTool: 'moo_list_goals' },
  DECISION_NOT_FOUND: { action: 'Check the id.', nextTool: 'moo_list_decisions' },
  PARENT_OPEN_SUBTASKS: { action: 'Complete or drop its open subtasks first.', nextTool: 'moo_get_task' },
  MANDATORY_REASON_MISSING: { action: 'Retry with a non-empty reason.' },
  TASK_NOT_CLAIMABLE: { action: 'Reopen it if the work must be redone, or pick other ready work.', nextTool: 'moo_reopen_task' },
  NOT_TASK_HOLDER: {
    action: 'Claim the task first (expired leases can be re-claimed), or pass the agentId you claimed it with.',
    nextTool: 'moo_claim_task',
  },
  INVALID_TASK_STATE: { action: 'Inspect the task status; claim it before working on it.', nextTool: 'moo_get_task' },
  HUMAN_ONLY_ACTION: { action: 'Ask the user to do this in the web board.', nextTool: 'moo_ask_human' },
  INVALID_ARGUMENTS: { action: 'Retry with the missing or corrected arguments.' },
};

const arr = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
};

const taskSummary = (t: Task) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  priority: t.priority,
  type: t.type,
  goalId: t.goalId,
  parentId: t.parentId,
  tags: t.tags,
  claimedByAgent: t.claimedByAgent,
  leaseExpiresAt: t.leaseExpiresAt,
  declaredFiles: t.declaredFiles?.length ? t.declaredFiles : undefined,
  isDeferred: t.isDeferred || undefined,
});

const decisionSummary = (d: Decision) => ({ id: d.id, title: d.title, choice: d.choice, tags: d.tags });

export function setupMcpServer(container: ServiceContainer, options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: 'moo-tasks', version: '1.1.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  const wsId = container.activeWorkspace?.id;
  const sessionId = `sess-${process.pid}-${Date.now().toString(36)}`;
  const identity = () => formatAgentIdentity(server.getClientVersion()?.name || 'mcp-client', process.ppid);
  const agentOf = (a: Args): string => (typeof a.agentId === 'string' && a.agentId.trim()) || identity();
  const leaseSeconds = (a: Args): number | undefined =>
    a.leaseMinutes ? Number(a.leaseMinutes) * 60 : a.leaseDurationMinutes ? Number(a.leaseDurationMinutes) * 60 : a.leaseDurationSeconds;

  const toolDefs = new Map<string, ToolDef>();
  for (const def of LEGACY_TOOL_DEFS) toolDefs.set(def.name, def);
  for (const def of TOOL_DEFS) toolDefs.set(def.name, def);

  let lastLeaseCleanup = 0;
  const cleanupLeases = () => {
    const now = Date.now();
    if (now - lastLeaseCleanup < LEASE_CLEANUP_INTERVAL_MS) return;
    lastLeaseCleanup = now;
    try {
      container.claimService.cleanupExpiredLeases(wsId);
    } catch {
      // Housekeeping must never fail a tool call
    }
  };

  const toDto = (t: Args): CreateTaskDTO => ({
    title: t.title,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria,
    goalId: t.goalId,
    parentId: t.parentId,
    type: t.type,
    priority: t.priority,
    tags: arr(t.tags),
    declaredFiles: arr(t.declaredFiles),
    dependsOnTaskIds: arr(t.dependsOnTaskIds ?? t.dependsOnTaskId),
    isDeferred: t.isDeferred,
    idempotencyKey: t.idempotencyKey,
    workspaceId: t.workspaceId || wsId,
  });

  const claimResponse = (res: ClaimTaskResult) => {
    if (res.autoEscalatedToHuman) {
      return {
        success: false,
        escalatedToHuman: true,
        task: taskSummary(res.task),
        hint: `Not claimed: attempt #${res.attemptCount} exceeded the limit, so the task now waits on the user. Do not work on it; pick other work.`,
      };
    }
    return {
      success: true,
      task: res.task,
      conflictWarnings: res.conflictWarnings.length ? res.conflictWarnings : undefined,
      relatedDecisions: res.relatedDecisions?.length ? res.relatedDecisions.map(decisionSummary) : undefined,
      previousFailureHistory: res.previousFailureHistory?.map((n) => ({ createdAt: n.createdAt, content: n.content })),
      hint: `Claimed until ${res.task.leaseExpiresAt} (renewed on each call with this taskId). Finish with moo_complete_task.`,
    };
  };

  const createTasks = (a: Args, agent: string) => {
    if (Array.isArray(a.tasks) && a.tasks.length > 0) {
      const results = container.taskLifecycleService.createBatch(a.tasks.map(toDto), agent, 'agent');
      return {
        success: true,
        createdCount: results.length,
        tasks: results.map((r) => ({
          ...taskSummary(r.task),
          possibleDuplicates: r.duplicateWarnings.length ? r.duplicateWarnings : undefined,
        })),
        hint: 'Call moo_get_next_task(claim: true) to start on the highest-priority ready task.',
      };
    }
    if (!a.title || !a.acceptanceCriteria) {
      throw new InvalidArgumentsError('moo_create_task needs title and acceptanceCriteria (or a non-empty tasks[] array).');
    }
    const created = container.taskLifecycleService.createTask(toDto(a), agent, 'agent');
    if (a.claim) {
      const claimed = container.claimService.claimTask(created.task.id, agent, sessionId, {
        declaredFiles: arr(a.declaredFiles),
        leaseDurationSeconds: leaseSeconds(a),
      });
      return {
        ...claimResponse(claimed),
        possibleDuplicates: created.duplicateWarnings.length ? created.duplicateWarnings : undefined,
      };
    }
    return {
      success: true,
      task: taskSummary(created.task),
      possibleDuplicates: created.duplicateWarnings.length ? created.duplicateWarnings : undefined,
      hint: `Created ${created.task.id}. Claim it with moo_claim_task before editing code.`,
    };
  };

  const updateGoal = (a: Args, agent: string) => {
    const { goalId, status, reason, reopenTasks, title, description, verbatimPrompt, maxOpenTasksCap } = a;
    const current = container.goalService.getGoal(goalId);
    let droppedTaskCount: number | undefined;
    if (status === 'dropped' && current.status !== 'dropped') {
      droppedTaskCount = container.goalService.killGoal(goalId, reason, agent).droppedTaskCount;
    } else if (status === 'active' && current.status !== 'active') {
      container.goalService.reopenGoal(goalId, agent, reopenTasks !== false);
    }
    const goal = container.goalService.updateGoal(goalId, {
      title,
      description,
      verbatimPrompt,
      maxOpenTasksCap,
      status: status === 'completed' ? status : undefined,
    });
    return { success: true, goal, droppedTaskCount };
  };

  const completeTask = (a: Args, agent: string) => {
    const evidence: TaskEvidence = { ...(a.evidence || {}) };
    delete (evidence as any).gitContext;
    if (a.autoClaimNext) {
      const res = container.verificationService.completeAndClaimNext(a.taskId, agent, sessionId, evidence, {
        notes: a.notes,
        nextClaimOptions: { declaredFiles: arr(a.nextDeclaredFiles), leaseDurationSeconds: a.nextLeaseSeconds },
      });
      return {
        success: true,
        completedTask: taskSummary(res.completedTask),
        filesModified: res.completedTask.evidence?.filesModified,
        nextTask: res.claimResult && !res.claimResult.autoEscalatedToHuman ? res.claimResult.task : null,
        relatedDecisions: res.claimResult?.relatedDecisions?.length
          ? res.claimResult.relatedDecisions.map(decisionSummary)
          : undefined,
        hint: res.hint,
      };
    }
    const task = container.verificationService.completeTask(a.taskId, agent, evidence, a.notes);
    return {
      success: true,
      task: { ...taskSummary(task), verificationState: task.verificationState },
      filesModified: task.evidence?.filesModified,
      diffSummary: task.evidence?.gitContext?.diffSummary,
      hint: 'Done. moo_get_next_task(claim: true) picks up the next ready task.',
    };
  };

  const logWork = (a: Args, agent: string) => {
    const evidence: TaskEvidence = { ...(a.evidence || {}) };
    delete (evidence as any).gitContext;
    // The work is already done, so there is no claim-time baseline: accept uncommitted changes as proof.
    if (!evidence.testProof?.trim() && !evidence.outputSnippet?.trim()) {
      const ctx = GitContextService.getContext(container.projectPath);
      const dirty = ctx.modifiedFiles || [];
      const claimed = arr(evidence.filesModified);
      const touched = claimed ? dirty.filter((f) => claimed.some((c) => f === c || f.endsWith('/' + c))) : dirty;
      if (touched.length > 0) {
        evidence.filesModified = touched;
        evidence.outputSnippet = `Uncommitted changes: ${touched.join(', ')}`;
      }
    }
    const created = container.taskLifecycleService.createTask(
      {
        title: a.title,
        description: a.description,
        acceptanceCriteria: a.acceptanceCriteria || a.title,
        type: a.type || 'chore',
        tags: arr(a.tags),
        goalId: a.goalId,
        workspaceId: wsId,
      },
      agent,
      'agent'
    );
    container.claimService.claimTask(created.task.id, agent, sessionId, { maxConcurrentTasksPerAgent: 2 });
    try {
      const task = container.verificationService.completeTask(created.task.id, agent, evidence);
      return { success: true, task: taskSummary(task), filesModified: task.evidence?.filesModified };
    } catch (err) {
      // Do not leave an empty claimed task behind when the evidence is rejected.
      container.taskLifecycleService.dropTask(created.task.id, 'moo_log_work rejected: missing evidence', agent, 'agent');
      throw err;
    }
  };

  const fileContext = (a: Args, agent: string) => {
    const filePaths = arr(a.filePaths ?? a.files) || [];
    const ctx = container.sessionService.getFileContext(filePaths, container.projectPath, wsId);
    const otherLocks = ctx.activeLocks.filter((l) => l.claimedByAgent !== agent);
    return {
      success: true,
      canEdit: otherLocks.length === 0,
      isLockedByOther: otherLocks.length > 0,
      activeLocks: ctx.activeLocks,
      pastTasks: ctx.pastTasks.map(taskSummary),
      relevantDecisions: ctx.relevantDecisions.map(decisionSummary),
      recentNotes: ctx.recentNotes.slice(0, 8).map((n) => ({ ...n, content: n.content.slice(0, 300) })),
      hint: otherLocks.length
        ? `Held by ${otherLocks.map((l) => l.claimedByAgent).join(', ')}; coordinate or wait for the lease.`
        : 'Free to edit.',
    };
  };

  const resume = (a: Args) => {
    const verbosity = a.verbosity || 'standard';
    const agent = typeof a.agentId === 'string' && a.agentId ? a.agentId : identity();
    if (verbosity === 'json') {
      const s = container.sessionService.whereDidILeaveOff(container.projectPath, agent, wsId);
      return {
        success: true,
        agentId: agent,
        webUi: options.webUiUrl,
        inProgress: s.abandonedDoingTasks.map(taskSummary),
        waitingOnHuman: s.waitingOnHumanTasks.map(taskSummary),
        ready: s.unblockedReadyTasks.map(taskSummary),
        activeGoals: s.activeGoals.map((g) => ({ id: g.id, title: g.title })),
        decisions: s.settledDecisions.slice(0, 10).map(decisionSummary),
        orphanTasks: s.orphanTasks.map(taskSummary),
      };
    }
    return container.sessionService.getCompactContext(container.projectPath, agent, verbosity, wsId, options.webUiUrl);
  };

  const dropOrReopen = (a: Args, agent: string, action: 'drop' | 'reopen') => {
    const ids = arr(a.taskIds) || arr(a.taskId) || [];
    if (ids.length === 0) throw new InvalidArgumentsError('Pass taskId or taskIds.');
    if (action === 'drop') {
      container.taskLifecycleService.bulkDrop(ids, a.reason, agent, 'agent');
    } else {
      container.taskLifecycleService.bulkReopen(ids, a.reason || 'Reopened', agent, 'agent');
    }
    return { success: true, [action === 'drop' ? 'droppedCount' : 'reopenedCount']: ids.length, taskIds: ids };
  };

  const recordDecision = (a: Args, agent: string) => {
    const dto = {
      workspaceId: a.workspaceId || wsId,
      title: a.title ?? a.newTitle,
      context: a.context ?? a.newContext,
      choice: a.choice ?? a.newChoice,
      rationale: a.rationale ?? a.newRationale,
      tags: arr(a.tags) || [],
      projectPath: container.projectPath,
      authorId: agent,
    };
    const oldId = a.supersedesDecisionId ?? a.oldDecisionId;
    if (oldId) {
      const res = container.decisionService.supersedeDecision(oldId, dto, a.supersedeReason ?? a.reason);
      return { success: true, decision: res.newDecision, superseded: decisionSummary(res.oldDecision) };
    }
    return { success: true, decision: container.decisionService.recordDecision(dto) };
  };

  const handlers: Record<string, (a: Args, agent: string) => unknown> = {
    // Goals
    moo_create_goal: (a) => {
      const goal = container.goalService.createGoal(
        a.title,
        a.verbatimPrompt,
        container.projectPath,
        a.maxOpenTasksCap,
        a.description,
        a.workspaceId || wsId
      );
      return {
        success: true,
        goal: { id: goal.id, title: goal.title, status: goal.status, maxOpenTasksCap: goal.maxOpenTasksCap },
        hint: `Add tasks with moo_create_task(goalId: '${goal.id}', tasks: [...]).`,
      };
    },
    moo_get_goal: (a) => {
      const summary = container.goalService.getGoalStatus(a.goalId);
      const { looseEnds, goal, ...metrics } = summary;
      return {
        success: true,
        goal,
        metrics,
        looseEnds: looseEnds.map(taskSummary),
        tasks:
          a.includeTasks !== false
            ? container.taskRepo.listByGoalId(a.goalId).filter((t) => !t.isArchived).map(taskSummary)
            : undefined,
      };
    },
    moo_update_goal: updateGoal,
    moo_list_goals: (a) => {
      const goals = container.goalService.listGoals(undefined, a.status, wsId);
      return { success: true, total: goals.length, goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status })) };
    },

    // Tasks
    moo_create_task: createTasks,
    moo_quick_start: (a, agent) => createTasks({ ...a, tasks: undefined, claim: true }, agent),
    moo_log_work: logWork,
    moo_update_task: (a) => {
      const { taskId, addDependsOn, removeDependsOn, ...rest } = a;
      const updates: Args = {};
      for (const key of ['title', 'description', 'type', 'priority', 'acceptanceCriteria', 'goalId', 'isDeferred']) {
        if (rest[key] !== undefined) updates[key] = rest[key];
      }
      if (rest.tags !== undefined) updates.tags = arr(rest.tags) || [];
      if (rest.declaredFiles !== undefined) updates.declaredFiles = arr(rest.declaredFiles) || [];
      if (Object.keys(updates).length > 0) container.taskLifecycleService.updateTask(taskId, updates);
      for (const dep of arr(addDependsOn) || []) container.taskLifecycleService.addDependency(taskId, dep);
      for (const dep of arr(removeDependsOn) || []) container.taskLifecycleService.removeDependency(taskId, dep);
      const task = container.taskLifecycleService.getTask(taskId);
      return { success: true, task: taskSummary(task), dependencies: container.taskRepo.getDependencies(taskId) };
    },
    moo_get_task: (a) => {
      const task = container.taskLifecycleService.getTask(a.taskId);
      return {
        success: true,
        task,
        dependencies: container.taskRepo.getDependencies(a.taskId),
        dependents: container.taskRepo.getDependents(a.taskId),
        subtasks: container.taskRepo.listSubtasks(a.taskId).map(taskSummary),
        notes: a.includeNotes === false ? undefined : container.noteRepo.listByTaskId(a.taskId).slice(-20),
      };
    },
    moo_list_tasks: (a) => {
      const tasks = container.taskRepo.list({
        workspaceId: a.workspaceId || wsId,
        goalId: a.goalId,
        status: a.status,
        priority: a.priority,
        type: a.type,
        tag: a.tag,
        tags: arr(a.tags),
        claimedByAgent: a.claimedByAgent,
        isDeferred: a.isDeferred,
        isArchived: false,
        limit: a.limit || 100,
      });
      return { success: true, total: tasks.length, tasks: tasks.map(taskSummary) };
    },
    moo_get_next_task: (a, agent) => {
      const next = container.taskLifecycleService.getNextUnblockedTask(a.goalId, agent, Boolean(a.avoidFileConflicts), wsId);
      if (next && a.claim) {
        return claimResponse(container.claimService.claimTask(next.id, agent, sessionId, { declaredFiles: arr(a.declaredFiles) }));
      }
      if (next) {
        return { success: true, nextTask: next, hint: `Claim it with moo_claim_task(taskId: '${next.id}').` };
      }
      const all = container.taskRepo.list({ workspaceId: wsId, goalId: a.goalId, isArchived: false });
      const count = (status: string) => all.filter((t) => t.status === status).length;
      return {
        success: true,
        nextTask: null,
        diagnostics: {
          message: 'No unblocked todo tasks are ready.',
          activeDoingTasks: count('doing'),
          blockedOnDependencies: count('blocked-on-dependency'),
          waitingOnHuman: count('waiting-on-human'),
          completedTasks: count('done'),
        },
      };
    },

    // Claims
    moo_claim_task: (a, agent) =>
      claimResponse(
        container.claimService.claimTask(a.taskId, agent, a.sessionId || sessionId, {
          declaredFiles: arr(a.declaredFiles),
          leaseDurationSeconds: leaseSeconds(a),
        })
      ),
    moo_checkpoint: (a, agent) => {
      const renewed = container.claimService.renewIfHolder(a.taskId, agent);
      const note = container.noteRepo.create({
        id: `note-${Math.random().toString(36).slice(2, 9)}`,
        taskId: container.taskLifecycleService.getTask(a.taskId).id,
        authorType: 'agent',
        authorId: agent,
        noteType: 'attempt_log',
        content: a.note,
        createdAt: new Date().toISOString(),
      });
      const task = container.taskRepo.findById(a.taskId);
      return {
        success: true,
        taskId: a.taskId,
        noteId: note.id,
        leaseRenewed: renewed,
        leaseExpiresAt: task?.leaseExpiresAt,
        hint: renewed ? 'Checkpoint saved; lease renewed.' : 'Note saved, but you do not hold this task, so no lease was renewed.',
      };
    },
    moo_release_task: (a, agent) => ({
      success: true,
      task: taskSummary(container.claimService.releaseTask(a.taskId, agent, a.notes)),
    }),
    moo_handoff_task: (a, agent) => ({
      success: true,
      task: taskSummary(
        container.claimService.handoffTask(a.taskId, a.fromAgentId || agent, a.toAgentId, a.handoffSummary, a.sessionId || sessionId)
      ),
    }),
    moo_complete_task: completeTask,
    moo_log_attempt_failure: (a, agent) => {
      const result = container.taskLifecycleService.logAttemptFailure({
        taskId: a.taskId,
        agentId: agent,
        errorSnippet: a.errorSnippet,
        failureCategory: a.failureCategory,
        hypothesis: a.hypothesis,
        nextAttemptPlan: a.nextAttemptPlan,
      });
      return {
        success: true,
        attemptCount: result.attemptCount,
        autoEscalatedToHuman: result.autoEscalatedToHuman,
        task: taskSummary(result.task),
        hint: result.autoEscalatedToHuman
          ? `Escalated to the user after ${result.task.maxAttemptsAllowed} attempts; stop working on it.`
          : `Attempt #${result.attemptCount} logged. Try the next plan.`,
      };
    },
    moo_drop_task: (a, agent) => dropOrReopen(a, agent, 'drop'),
    moo_reopen_task: (a, agent) => dropOrReopen(a, agent, 'reopen'),

    // Humans, notes, discovered work
    moo_ask_human: (a, agent) => {
      const task = container.humanCollabService.askHuman(a.taskId, agent, a.question, a.questionType, arr(a.options));
      return {
        success: true,
        task: { ...taskSummary(task), humanQuestion: task.humanQuestion, humanOptions: task.humanOptions },
        hint: 'The task now waits on the user; it appears in their inbox on the web board.',
      };
    },
    moo_add_task_note: (a, agent) => ({
      success: true,
      note: container.noteRepo.create({
        id: `note-${Math.random().toString(36).slice(2, 9)}`,
        taskId: container.taskLifecycleService.getTask(a.taskId).id,
        authorType: 'agent',
        authorId: agent,
        noteType: a.noteType || 'general',
        content: a.content,
        createdAt: new Date().toISOString(),
      }),
    }),
    moo_capture_discovered_work: (a, agent) => {
      const res = container.discoveredWorkService.captureWork({
        ...a,
        agentId: agent,
        tags: arr(a.tags),
        declaredFiles: arr(a.declaredFiles),
      } as any);
      return { success: true, newTask: taskSummary(res.newTask), currentTask: taskSummary(res.currentTask) };
    },

    // Decisions
    moo_record_decision: recordDecision,
    moo_list_decisions: (a) => {
      const decisions = container.decisionService.listDecisions(undefined, a.status, a.tag, a.workspaceId || wsId);
      return { success: true, total: decisions.length, decisions };
    },

    // Context
    moo_session_resume: resume,
    moo_get_file_context: fileContext,
    moo_search: (a) => {
      const res = container.searchService.search(a.query, { type: a.type, limit: a.limit, workspaceId: wsId });
      return {
        success: true,
        query: res.query,
        total: res.total,
        results: res.results.map(({ task, decision, ...item }) => item),
      };
    },

    // ---- Legacy names (not listed; kept callable for older rule files) ----
    moo_get_goal_status: (a) => ({ success: true, summary: container.goalService.getGoalStatus(a.goalId) }),
    moo_kill_goal: (a, agent) => ({ success: true, ...container.goalService.killGoal(a.goalId, a.reason, agent) }),
    moo_reopen_goal: (a, agent) => ({
      success: true,
      goal: container.goalService.reopenGoal(a.goalId, agent, a.reopenTasks !== false),
    }),
    moo_create_tasks_batch: (a, agent) => createTasks({ tasks: Array.isArray(a.tasks) ? a.tasks : [a.tasks].filter(Boolean) }, agent),
    moo_link_dependencies: (a) => {
      for (const dep of arr(a.dependsOnTaskIds ?? a.dependsOnTaskId) || []) {
        container.taskLifecycleService.addDependency(a.taskId, dep);
      }
      const task = container.taskLifecycleService.getTask(a.taskId);
      return { success: true, taskId: a.taskId, dependencies: container.taskRepo.getDependencies(a.taskId), status: task.status };
    },
    moo_unlink_dependencies: (a) => {
      for (const dep of arr(a.dependsOnTaskIds ?? a.dependsOnTaskId) || []) {
        container.taskLifecycleService.removeDependency(a.taskId, dep);
      }
      const task = container.taskLifecycleService.getTask(a.taskId);
      return { success: true, taskId: a.taskId, dependencies: container.taskRepo.getDependencies(a.taskId), status: task.status };
    },
    moo_heartbeat_task: (a, agent) => ({
      success: true,
      task: container.claimService.heartbeatTask(a.taskId, agent, a.extensionSeconds),
    }),
    moo_complete_and_claim_next: (a, agent) => completeTask({ ...a, autoClaimNext: true }, agent),
    moo_reject_task: (a, agent) => ({
      success: true,
      task: taskSummary(container.verificationService.rejectTask(a.taskId, agent, 'agent', a.reason)),
    }),
    moo_get_human_inbox: (a) => {
      const inbox = container.humanCollabService.getHumanInbox(a.goalId, wsId);
      return { success: true, total: inbox.length, inbox };
    },
    moo_list_task_notes: (a) => {
      const notes = container.noteRepo.listByTaskId(a.taskId);
      return { success: true, total: notes.length, notes };
    },
    moo_undo_status_change: (a, agent) => ({
      success: true,
      task: container.taskLifecycleService.undoStatusChange(a.taskId, agent, 'agent'),
    }),
    moo_bulk_drop_tasks: (a, agent) => dropOrReopen(a, agent, 'drop'),
    moo_bulk_reopen_tasks: (a, agent) => dropOrReopen(a, agent, 'reopen'),
    moo_supersede_decision: recordDecision,
    moo_merge_tasks: (a, agent) => ({
      success: true,
      ...container.duplicateMergeService.mergeTasks(a.targetTaskId, a.sourceTaskId, agent, a.reason),
    }),
    moo_get_compact_context: resume,
    moo_check_file_lock: fileContext,
    moo_import_markdown: (a, agent) => {
      const result = container.markdownImportService.importMarkdown(a.content, {
        goalId: a.goalId,
        goalTitle: a.goalTitle,
        projectPath: container.projectPath,
        sequentialPhases: a.sequentialPhases !== false,
        authorId: agent,
        authorType: 'agent',
        workspaceId: wsId,
      });
      return {
        success: true,
        goal: result.goal,
        importedCount: result.importedCount,
        tasks: result.tasks.map(taskSummary),
        hint: `Imported ${result.importedCount} tasks from the markdown plan.`,
      };
    },
    moo_export_project: (a) => container.housekeepingService.exportProject(container.projectPath, a.format || 'markdown'),
    moo_archive_completed: (a) => ({ success: true, archivedCount: container.housekeepingService.archiveCompleted(a.goalId) }),
    moo_list_workspaces: () => {
      const workspaces = container.workspaceService.listWorkspaces();
      return { success: true, activeWorkspace: container.activeWorkspace, total: workspaces.length, workspaces };
    },
    moo_get_workspace: (a) => {
      const ws = a.workspaceId ? container.workspaceService.getWorkspace(a.workspaceId) : container.activeWorkspace;
      return { success: Boolean(ws), workspace: ws };
    },
    moo_register_workspace: (a) => ({
      success: true,
      workspace: container.workspaceService.getOrCreateWorkspace(a.projectPath, a.name),
    }),
    moo_update_workspace: (a) => ({
      success: true,
      workspace: container.workspaceService.updateWorkspace(a.workspaceId || container.activeWorkspace.id, {
        name: a.name,
        gitRemote: a.gitRemote,
      }),
    }),
    moo_delete_workspace: (a) => ({ success: container.workspaceService.deleteWorkspace(a.workspaceId) }),
  };

  const validate = (name: string, a: Args) => {
    const def = toolDefs.get(name);
    const required = (def?.inputSchema.required || []).filter((field) => !IMPLICIT_FIELDS.has(field));
    const missing = required.filter((field) => a[field] === undefined || a[field] === null || a[field] === '');
    if (missing.length > 0) {
      throw new InvalidArgumentsError(`${name} is missing required argument(s): ${missing.join(', ')}.`);
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs = {} } = request.params;
    const args = rawArgs as Args;

    try {
      if (HUMAN_ONLY_TOOLS.has(name)) {
        throw new HumanOnlyActionError(name);
      }
      const handler = handlers[name];
      if (!handler) {
        throw new InvalidArgumentsError(`Unknown tool: ${name}. Available: ${TOOL_DEFS.map((t) => t.name).join(', ')}`);
      }
      validate(name, args);
      cleanupLeases();

      const agent = agentOf(args);
      if (typeof args.taskId === 'string' && !NO_RENEW_TOOLS.has(name)) {
        container.claimService.renewIfHolder(args.taskId, agent);
      }

      const result = handler(args, agent);
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    } catch (err: any) {
      const code = err?.code || (err?.name === 'ZodError' ? 'INVALID_ARGUMENTS' : 'TOOL_ERROR');
      const recovery = RECOVERY[code];
      const payload = {
        success: false,
        error: err?.message || String(err),
        code,
        recoveryAction: recovery?.action || 'Check the arguments against the tool schema and retry.',
        nextTool: recovery?.nextTool,
        expectedArguments: code === 'INVALID_ARGUMENTS' ? toolDefs.get(name)?.inputSchema : undefined,
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
    }
  });

  // --- MCP Native Resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'moo://context/compact',
        name: 'Compact Context',
        description: 'Token-dense summary of the active goal, claimed task, decisions and file locks',
        mimeType: 'text/markdown',
      },
      {
        uri: 'moo://goals/active',
        name: 'Active Goals',
        description: 'Active goals in this workspace with specs and progress',
        mimeType: 'text/markdown',
      },
      {
        uri: 'moo://tasks/ready',
        name: 'Ready Queue',
        description: 'Unblocked todo tasks in this workspace',
        mimeType: 'application/json',
      },
      {
        uri: 'moo://decisions/settled',
        name: 'Settled Architectural Decisions (ADR)',
        description: 'Accepted decisions in this workspace',
        mimeType: 'text/markdown',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const text = (mimeType: string, body: string) => ({ contents: [{ uri, mimeType, text: body }] });

    if (uri === 'moo://context/compact') {
      return text(
        'text/markdown',
        container.sessionService.getCompactContext(container.projectPath, undefined, 'standard', wsId, options.webUiUrl)
      );
    }

    if (uri === 'moo://goals/active') {
      const goals = container.goalService.listGoals(undefined, 'active', wsId);
      const lines: string[] = ['# 🎯 Active Project Goals\n'];
      for (const g of goals) {
        const status = container.goalService.getGoalStatus(g.id);
        lines.push(`## [${g.id}] ${g.title}`);
        lines.push(
          `- **Status**: ${g.status} | **Progress**: ${status.completedTasks}/${status.totalTasks} completed (${status.openTasks} open, max cap: ${g.maxOpenTasksCap})`
        );
        if (g.verbatimPrompt) lines.push(`- **Original Prompt**: *"${g.verbatimPrompt}"*`);
        if (g.description) lines.push(`\n### Specification\n${g.description}\n`);
        lines.push('---');
      }
      return text('text/markdown', lines.join('\n'));
    }

    if (uri === 'moo://tasks/ready') {
      const allTasks = container.taskRepo.list({ isArchived: false, isDeferred: false, workspaceId: wsId });
      const allDeps = container.taskRepo.getAllDependencies();
      const taskMap = new Map(container.taskRepo.list({ workspaceId: wsId }).map((t) => [t.id, t]));
      const unblocked = allTasks
        .filter((t) => t.status === 'todo')
        .filter((t) => DependencyGraph.isTaskUnblocked(t.id, allDeps, taskMap));
      return text('application/json', JSON.stringify({ readyTasks: unblocked, total: unblocked.length }, null, 2));
    }

    if (uri === 'moo://decisions/settled') {
      const decisions = container.decisionService.listDecisions(undefined, 'accepted', undefined, wsId);
      const lines: string[] = ['# 🏛️ Settled Architectural Decision Records (ADR)\n'];
      for (const d of decisions) {
        lines.push(`## [${d.id}] ${d.title}`);
        lines.push(`- **Choice**: \`${d.choice}\``);
        lines.push(`- **Rationale**: ${d.rationale}`);
        if (d.tags && d.tags.length > 0) lines.push(`- **Tags**: ${d.tags.map((t) => `\`${t}\``).join(', ')}`);
        if (d.context) lines.push(`- **Context**: ${d.context}`);
        lines.push('---');
      }
      return text('text/markdown', lines.join('\n'));
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });

  // --- MCP Native Prompts ---
  const planArgs = [{ name: 'featureRequest', description: 'The verbatim feature request from the human user', required: true }];
  const executeArgs = [{ name: 'agentId', description: 'Agent ID claiming and executing the task', required: false }];

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'moo_plan_feature',
        description: 'Break a feature request into a goal and atomic tasks.',
        arguments: planArgs,
      },
      {
        name: 'moo_execute_next',
        description: 'Claim the top ready task, implement it, and complete it with proof.',
        arguments: executeArgs,
      },
      { name: 'moo-plan-feature', description: 'Alias for moo_plan_feature', arguments: planArgs },
      { name: 'moo-execute-next', description: 'Alias for moo_execute_next', arguments: executeArgs },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs = {} } = request.params;

    if (name === 'moo_plan_feature' || name === 'moo-plan-feature') {
      const featureRequest = (promptArgs as any).featureRequest || '';
      return {
        description: 'Break down a user request into a Goal and atomic tasks with acceptance criteria',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Plan the following request with Moo Tasks:\n\n"${featureRequest}"\n\n1. moo_create_goal(title, verbatimPrompt, description) with a Markdown PRD.\n2. moo_create_task(goalId, tasks: [...]) with atomic tasks, acceptance criteria and dependsOnTaskIds.\n3. moo_session_resume to review the plan before implementation.`,
            },
          },
        ],
      };
    }

    if (name === 'moo_execute_next' || name === 'moo-execute-next') {
      const agentId = (promptArgs as any).agentId;
      const agentHint = agentId ? ` Pass agentId: '${agentId}' on every call.` : '';
      return {
        description: 'Execute the top unblocked task from Moo Tasks ready queue',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Execute the next ready task in Moo Tasks.${agentHint}\n\n1. moo_get_next_task(claim: true) to claim the top unblocked task.\n2. Implement it and run the tests.\n3. moo_complete_task(taskId, evidence: { testProof, commandsRun }) — add autoClaimNext: true to continue.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}
