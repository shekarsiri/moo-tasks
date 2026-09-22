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
}

const str = (description?: string) => (description ? { type: 'string', description } : { type: 'string' });
const strArr = (description?: string) =>
  description ? { type: 'array', items: { type: 'string' }, description } : { type: 'array', items: { type: 'string' } };
const TYPE = { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'] };
const PRIORITY = { type: 'string', enum: ['low', 'medium', 'high', 'critical'] };
const EVIDENCE = {
  type: 'object',
  description: 'Proof of work. testProof or outputSnippet (real output), or code changes git sees since the claim.',
  properties: {
    testProof: str(),
    outputSnippet: str(),
    commandsRun: strArr(),
    filesModified: strArr('Auto-filled from git when omitted'),
    notes: str(),
  },
};
const AGENT_ID = str('Override the default identity (set one per parallel sub-agent)');

const TASK_FIELDS = {
  title: str('Clean descriptive title; no "C1:"/"H2:" prefixes (use priority/type/tags)'),
  description: str('Markdown spec: overview, numbered plan, key design decisions'),
  acceptanceCriteria: str('Markdown checklist (- [ ]) defining done'),
  goalId: str('Omit to file under the workspace "Ad-hoc work" goal'),
  parentId: str('Parent task (one level of subtasks)'),
  type: TYPE,
  priority: PRIORITY,
  tags: strArr(),
  declaredFiles: strArr('Files you expect to modify (collision detection)'),
  dependsOnTaskIds: strArr(),
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
    description: 'Goal spec, progress metrics and loose ends; includeTasks lists task summaries.',
    inputSchema: {
      type: 'object',
      properties: { goalId: str(), includeTasks: { type: 'boolean' } },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_update_goal',
    description: "Edit a goal. status 'dropped' (needs reason) drops its open tasks; status 'active' reopens it.",
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
        reopenTasks: { type: 'boolean', description: "When reactivating, also reopen tasks dropped with the goal (default true)" },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_list_goals',
    description: "List this workspace's goals.",
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
        leaseMinutes: { type: 'number', description: 'Claim lease (default 30)' },
        agentId: AGENT_ID,
      },
    },
  },
  {
    name: 'moo_quick_start',
    description: 'Create and claim a task in one call; start coding right after. goalId optional.',
    inputSchema: {
      type: 'object',
      properties: { ...TASK_FIELDS, leaseMinutes: { type: 'number' }, agentId: AGENT_ID },
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
        acceptanceCriteria: str('Defaults to the title'),
        type: TYPE,
        tags: strArr(),
        goalId: str(),
        evidence: EVIDENCE,
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
    inputSchema: { type: 'object', properties: { taskId: str(), includeNotes: { type: 'boolean' } }, required: ['taskId'] },
  },
  {
    name: 'moo_list_tasks',
    description: 'Task summaries in this workspace, filterable.',
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
        agentId: AGENT_ID,
      },
    },
  },

  // Claims
  {
    name: 'moo_claim_task',
    description: 'Claim a task exclusively (30 min lease, renewed whenever you call a tool with its taskId).',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), declaredFiles: strArr(), leaseMinutes: { type: 'number' }, agentId: AGENT_ID },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_checkpoint',
    description: 'Log a progress note on your claimed task and renew its lease.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), note: str(), agentId: AGENT_ID },
      required: ['taskId', 'note'],
    },
  },
  {
    name: 'moo_release_task',
    description: 'Give up your claim; the task returns to the queue.',
    inputSchema: { type: 'object', properties: { taskId: str(), notes: str(), agentId: AGENT_ID }, required: ['taskId'] },
  },
  {
    name: 'moo_handoff_task',
    description: 'Transfer your claim to another agent with a summary.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), toAgentId: str(), handoffSummary: str(), agentId: AGENT_ID },
      required: ['taskId', 'toAgentId', 'handoffSummary'],
    },
  },
  {
    name: 'moo_complete_task',
    description: 'Complete your claimed task with evidence. autoClaimNext claims the next ready task in the goal.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: str(),
        evidence: EVIDENCE,
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
    name: 'moo_add_task_note',
    description: 'Attach a note to a task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: str(), content: str(), noteType: str(), agentId: AGENT_ID },
      required: ['taskId', 'content'],
    },
  },
  {
    name: 'moo_capture_discovered_work',
    description:
      'Record work found mid-task. isMustFixNow=true blocks your current task on it; otherwise it is deferred.',
    inputSchema: {
      type: 'object',
      properties: {
        currentTaskId: str(),
        title: str(),
        acceptanceCriteria: str(),
        isMustFixNow: { type: 'boolean' },
        description: str(),
        type: TYPE,
        priority: PRIORITY,
        tags: strArr(),
        declaredFiles: strArr(),
        agentId: AGENT_ID,
      },
      required: ['currentTaskId', 'title', 'acceptanceCriteria', 'isMustFixNow'],
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
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['proposed', 'accepted', 'superseded', 'rejected'] }, tag: str() },
    },
  },

  // Context
  {
    name: 'moo_session_resume',
    description:
      'Where you left off: your claimed task, ready work, waiting-on-human, decisions, stall warnings. Call at session start.',
    inputSchema: {
      type: 'object',
      properties: { verbosity: { type: 'string', enum: ['ultra-dense', 'standard', 'full', 'json'] }, agentId: AGENT_ID },
    },
  },
  {
    name: 'moo_get_file_context',
    description: 'Before editing files: who holds them now (canEdit), past tasks, decisions and notes about them.',
    inputSchema: { type: 'object', properties: { filePaths: strArr(), agentId: AGENT_ID }, required: ['filePaths'] },
  },
  {
    name: 'moo_search',
    description: 'Full-text search over tasks and decisions in this workspace.',
    inputSchema: {
      type: 'object',
      properties: { query: str(), type: { type: 'string', enum: ['all', 'tasks', 'decisions'] }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
];
