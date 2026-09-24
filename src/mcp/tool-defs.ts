/**
 * The MCP tool surface listed to agents. Descriptions are deliberately short: every
 * byte here is loaded into every agent context that connects to Moo Tasks.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  /** MCP hints; readOnlyHint lets clients auto-approve and parallelize a tool. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

const str = (description?: string) => (description ? { type: 'string', description } : { type: 'string' });
const strArr = (description?: string) =>
  description ? { type: 'array', items: { type: 'string' }, description } : { type: 'array', items: { type: 'string' } };
const TYPE = { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'] };
const PRIORITY = { type: 'string', enum: ['low', 'medium', 'high', 'critical'] };
const EVIDENCE = {
  type: 'object',
  description: 'testProof or outputSnippet with real output; git changes since the claim also count.',
  properties: { testProof: str(), outputSnippet: str(), commandsRun: strArr(), filesModified: strArr('Default: from git') },
};
// The identity rule is spelled out once, on the tools a parallel sub-agent starts with.
const CRITERIA = {
  type: 'array',
  description: 'One answer per "- [ ]" acceptance item, in order: {met, note (required when unmet)}',
  items: { type: 'object', properties: { item: str(), met: { type: 'boolean' }, note: str() }, required: ['met'] },
};
const VERIFY_OVERRIDE = str("Why the workspace verify command's failure is unrelated; completes as a deviation");
const AGENT_ID_DOC = str('Override the default identity (set one per parallel sub-agent)');
const AGENT_ID = str();
const READ_ONLY = { readOnlyHint: true };

const QUICK_FIELDS = {
  title: str('Plain title; no "C1:" prefixes'),
  description: str('Markdown spec: overview, numbered plan, key design decisions'),
  acceptanceCriteria: str('Markdown checklist (- [ ]) defining done'),
  goalId: str('Omit to file under the workspace "Ad-hoc work" goal'),
  type: TYPE,
  priority: PRIORITY,
  tags: strArr(),
  declaredFiles: strArr('Files you expect to modify (collision detection)'),
  dependsOnTaskIds: strArr(),
};
const TASK_FIELDS = {
  ...QUICK_FIELDS,
  parentId: str('Parent task (one level of subtasks)'),
  isDeferred: { type: 'boolean' },
  idempotencyKey: str(),
};

export const TOOL_DEFS: ToolDef[] = [
  // Goals
  {
    name: 'moo_create_goal',
    description: "Anchor a user request as a goal: verbatim prompt plus Markdown PRD. Caps open tasks (default 10).",
    inputSchema: {
      type: 'object',
      properties: {
        title: str(),
        verbatimPrompt: str("The user's exact request"),
        description: str('Markdown PRD, architecture, milestones'),
        maxOpenTasksCap: { type: 'number' },
      },
      required: ['title', 'verbatimPrompt'],
    },
  },
  {
    name: 'moo_get_goal',
    description: 'Goal spec, progress metrics and open tasks; includeTasks=true lists every task.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { goalId: str(), includeTasks: { type: 'boolean' } },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_update_goal',
    description: "Edit a goal. 'completed' writes its summary; 'dropped' (needs reason) drops its open tasks; 'active' reopens it.",
    inputSchema: {
      type: 'object',
      properties: {
        goalId: str(),
        title: str(),
        description: str(),
        verbatimPrompt: str(),
        maxOpenTasksCap: { type: 'number' },
        status: { type: 'string', enum: ['active', 'completed', 'dropped'] },
        reason: str('Required when dropping'),
        summary: str('On completing: your retrospective; a record of shipped work, deviations and decisions is appended'),
        reopenTasks: { type: 'boolean', description: 'On reactivate, reopen its dropped tasks (default true)' },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_list_goals',
    description: "List this workspace's goals.",
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'completed', 'dropped'] } } },
  },

  // Tasks
  {
    name: 'moo_create_task',
    description:
      'Create one task, or many via tasks[] (all-or-nothing). claim=true also claims it (single task only).',
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_FIELDS,
        tasks: { type: 'array', items: { type: 'object' }, description: 'Batch create: objects with the same fields as a single task' },
        claim: { type: 'boolean' },
        leaseMinutes: { type: 'number' },
        agentId: AGENT_ID,
      },
    },
  },
  {
    name: 'moo_quick_start',
    description: 'Create and claim a task in one call; start coding right after. goalId optional.',
    inputSchema: {
      type: 'object',
      properties: { ...QUICK_FIELDS, leaseMinutes: { type: 'number' }, agentId: AGENT_ID_DOC },
      required: ['title', 'acceptanceCriteria'],
    },
  },
  {
    name: 'moo_log_work',
    description:
      'Record small work already done (quick fix, config tweak) as a completed task in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        title: str(),
        description: str(),
        type: TYPE,
        goalId: str(),
        evidence: EVIDENCE,
        verifyOverride: VERIFY_OVERRIDE,
        agentId: AGENT_ID,
      },
      required: ['title', 'evidence'],
    },
  },
  {
    name: 'moo_update_task',
    description: 'Edit task fields and dependencies (addDependsOn / removeDependsOn).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: str(),
        title: str(),
        description: str(),
        acceptanceCriteria: str(),
        type: TYPE,
        priority: PRIORITY,
        tags: strArr(),
        declaredFiles: strArr(),
        goalId: str(),
        isDeferred: { type: 'boolean' },
        addDependsOn: strArr(),
        removeDependsOn: strArr(),
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_get_task',
    description: 'Full task with dependencies, subtasks and notes.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { taskId: str(), includeNotes: { type: 'boolean' } }, required: ['taskId'] },
  },
  {
    name: 'moo_list_tasks',
    description: 'Task summaries in this workspace, filterable.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        goalId: str(),
        status: {
          type: 'string',
          enum: ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human', 'done', 'dropped'],
        },
        priority: PRIORITY,
        type: TYPE,
        tag: str(),
        claimedByAgent: str(),
        stale: { type: 'boolean', description: 'Only stale backlog, with the reason' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'moo_get_next_task',
    description: 'Highest-priority unblocked todo task in this workspace; claim=true claims it.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: str(),
        avoidFileConflicts: { type: 'boolean' },
        claim: { type: 'boolean' },
        agentId: AGENT_ID_DOC,
      },
    },
  },

  // Claims
  {
    name: 'moo_claim_task',
    description: 'Claim a task exclusively (30 min lease, renewed whenever you call a tool with its taskId).',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), declaredFiles: strArr(), leaseMinutes: { type: 'number' }, agentId: AGENT_ID_DOC },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_checkpoint',
    description: 'Add a note to a task (progress, finding, context); renews your lease if you hold it.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), note: str(), noteType: str('Default attempt_log'), agentId: AGENT_ID },
      required: ['taskId', 'note'],
    },
  },
  {
    name: 'moo_release_task',
    description: 'Give up your claim: back to the queue, or to toAgentId as a handoff.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), notes: str('Handoff summary when toAgentId is set'), toAgentId: str(), agentId: AGENT_ID },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_complete_task',
    description: 'Complete your claimed task: evidence plus one criteria answer per acceptance item. Runs the workspace verify command.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: str(),
        evidence: EVIDENCE,
        criteria: CRITERIA,
        verifyOverride: VERIFY_OVERRIDE,
        notes: str(),
        autoClaimNext: { type: 'boolean' },
        agentId: AGENT_ID,
      },
      required: ['taskId', 'evidence'],
    },
  },
  {
    name: 'moo_log_attempt_failure',
    description: 'Record a failed attempt (error, hypothesis, next plan). Repeated failures escalate to a human.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: str(),
        errorSnippet: str(),
        failureCategory: str(),
        hypothesis: str(),
        nextAttemptPlan: str(),
        agentId: AGENT_ID,
      },
      required: ['taskId', 'errorSnippet'],
    },
  },
  {
    name: 'moo_drop_task',
    description: 'Drop one task (taskId) or several (taskIds) with a reason.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), taskIds: strArr(), reason: str() },
      required: ['reason'],
    },
  },
  {
    name: 'moo_reopen_task',
    description: 'Reopen one task (taskId) or several (taskIds).',
    inputSchema: { type: 'object', properties: { taskId: str(), taskIds: strArr(), reason: str() } },
  },

  // Humans, notes, discovered work
  {
    name: 'moo_ask_human',
    description: 'Pause a task on a question for the user (clarification, approval, credential, decision).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: str(),
        question: str(),
        questionType: { type: 'string', enum: ['clarification', 'approval', 'credential', 'decision'] },
        options: strArr('Selectable answers'),
        agentId: AGENT_ID,
      },
      required: ['taskId', 'question'],
    },
  },
  {
    name: 'moo_capture_discovered_work',
    description:
      'Record work found mid-task: alreadyFixed=true logs a fix you made along the way; isMustFixNow=true blocks your task on it; otherwise deferred.',
    inputSchema: {
      type: 'object',
      properties: {
        currentTaskId: str(),
        title: str(),
        acceptanceCriteria: str(),
        alreadyFixed: { type: 'boolean' },
        fixNote: str('What was wrong and how you fixed it (alreadyFixed)'),
        isMustFixNow: { type: 'boolean' },
        description: str(),
        type: TYPE,
        priority: PRIORITY,
        declaredFiles: strArr(),
        agentId: AGENT_ID,
      },
      required: ['currentTaskId', 'title'],
    },
  },

  // Decisions
  {
    name: 'moo_record_decision',
    description: 'Record an architectural decision (ADR). supersedesDecisionId replaces an older one.',
    inputSchema: {
      type: 'object',
      properties: {
        title: str(),
        context: str(),
        choice: str(),
        rationale: str(),
        tags: strArr(),
        supersedesDecisionId: str(),
        supersedeReason: str(),
      },
      required: ['title', 'context', 'choice', 'rationale'],
    },
  },
  {
    name: 'moo_list_decisions',
    description: "This workspace's decisions.",
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['proposed', 'accepted', 'superseded', 'rejected'] },
        tag: str(),
        verbose: { type: 'boolean', description: 'Full context and rationale' },
      },
    },
  },

  // Context
  {
    name: 'moo_session_resume',
    description:
      'Where you left off: your claimed task, ready work, waiting-on-human, decisions, stall warnings. Call at session start.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { verbosity: { type: 'string', enum: ['ultra-dense', 'standard', 'full', 'json'] }, agentId: AGENT_ID },
    },
  },
  {
    name: 'moo_get_file_context',
    description: 'Before editing files: who holds them now (canEdit), past tasks, decisions and notes about them.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { filePaths: strArr(), agentId: AGENT_ID }, required: ['filePaths'] },
  },
  {
    name: 'moo_search',
    description: 'Full-text search over tasks and decisions in this workspace.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { query: str(), type: { type: 'string', enum: ['all', 'tasks', 'decisions'] }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
];
