/**
 * Original (pre-consolidation) MCP tool definitions. They are no longer listed to agents,
 * but every name stays callable so older AGENTS.md files and raw MCP callers keep working.
 */
import { ToolDef } from './tool-defs.js';

export const LEGACY_TOOL_DEFS: ToolDef[] = [
  // 1. Goals
  {
    name: 'moo_create_goal',
    description: 'Record a human user request verbatim as an overarching Goal with rich Markdown PRD/spec. Tasks will link back to this goal. Caps open tasks to prevent over-planning.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Brief descriptive title for the goal' },
        verbatimPrompt: { type: 'string', description: 'Verbatim text of the human user request' },
        description: { type: 'string', description: 'Comprehensive Markdown PRD, architectural breakdown, component boundaries, and milestone plan' },
        maxOpenTasksCap: { type: 'number', description: 'Maximum open tasks allowed under this goal (default: 10)' },
      },
      required: ['title', 'verbatimPrompt'],
    },
  },
  {
    name: 'moo_get_goal',
    description: 'Get full details of a goal including rich markdown PRD/spec, status metrics, and all child tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID (e.g. goal-abc12345)' },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_update_goal',
    description: 'Update goal details: rich markdown PRD/specification, title, verbatim prompt, max open tasks cap, or status.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID to update' },
        title: { type: 'string', description: 'Updated goal title' },
        description: { type: 'string', description: 'Updated full rich Markdown PRD, architectural design, and task definition' },
        verbatimPrompt: { type: 'string', description: 'Updated verbatim human prompt' },
        maxOpenTasksCap: { type: 'number', description: 'Updated open tasks cap' },
        status: { type: 'string', enum: ['active', 'completed', 'dropped'] },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_list_goals',
    description: 'List all project goals and their statuses (active, completed, dropped).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'completed', 'dropped'] },
      },
    },
  },
  {
    name: 'moo_get_goal_status',
    description: 'Check goal coverage, open tasks vs cap, loose ends (uncompleted tasks), and completion metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID (e.g. goal-abc12345)' },
      },
      required: ['goalId'],
    },
  },
  {
    name: 'moo_kill_goal',
    description: 'Drop an entire goal and cascade drop all open tasks under it in one action with a mandatory reason.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID to drop/kill' },
        reason: { type: 'string', description: 'Mandatory explanation for killing the goal' },
        authorId: { type: 'string', description: 'Agent or user ID' },
      },
      required: ['goalId', 'reason'],
    },
  },
  {
    name: 'moo_reopen_goal',
    description: 'Reopen a dropped or completed goal and optionally reopen its tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID to reopen' },
        reopenTasks: { type: 'boolean', description: 'Whether to reopen dropped tasks under this goal (default: true)' },
      },
      required: ['goalId'],
    },
  },

  // 2. Tasks & Lifecycle
  {
    name: 'moo_create_task',
    description: 'Create a task under a goal (or standalone) with detailed technical description, acceptance criteria, type, tags, priority, declared files, and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Concise, actionable task title. Must be clean descriptive text — do NOT embed priority codes, category prefixes, or sequence numbers (e.g. avoid "C1:", "H2:", "UX-3:", "M1 —"). Use the priority, type, and tags fields instead.' },
        description: { type: 'string', description: 'Comprehensive Markdown technical specification containing architecture overview, step-by-step implementation plan, design rationale, and code snippets' },
        goalId: { type: 'string', description: 'Goal ID this task belongs to' },
        parentId: { type: 'string', description: 'Parent Task ID if this is a subtask (max 1 level depth)' },
        acceptanceCriteria: { type: 'string', description: 'Mandatory testable criteria defining when task is done (written before code)' },
        type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'], description: 'Task category type (default: feature)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Array of contextual tag labels (e.g. ["auth", "frontend"])' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Task priority' },
        dependsOnTaskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs this task depends on' },
        declaredFiles: { type: 'array', items: { type: 'string' }, description: 'Files or directories this task will touch' },
        idempotencyKey: { type: 'string', description: 'Unique idempotency key to prevent accidental duplicate creations' },
        isDeferred: { type: 'boolean', description: 'Whether to place in deferred pile (excluded from active queue)' },
      },
      required: ['title', 'acceptanceCriteria'],
    },
  },
  {
    name: 'moo_create_tasks_batch',
    description: 'Batch create multiple tasks under a goal with full technical descriptions, criteria, types, tags, and dependencies in a single operation.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Clean descriptive title without priority/category prefixes — use priority, type, and tags fields instead' },
              description: { type: 'string', description: 'Comprehensive Markdown technical specification and implementation plan' },
              goalId: { type: 'string' },
              parentId: { type: 'string' },
              acceptanceCriteria: { type: 'string' },
              type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'] },
              tags: { type: 'array', items: { type: 'string' } },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              dependsOnTaskIds: { type: 'array', items: { type: 'string' } },
              declaredFiles: { type: 'array', items: { type: 'string' } },
              idempotencyKey: { type: 'string' },
              isDeferred: { type: 'boolean' },
            },
            required: ['title', 'acceptanceCriteria'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'moo_update_task',
    description: 'Update task properties: title, description, type, tags, priority, acceptance criteria, declared files, goal, or deferred state.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'Updated title' },
        description: { type: 'string', description: 'Updated description' },
        acceptanceCriteria: { type: 'string', description: 'Updated acceptance criteria' },
        type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'] },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        goalId: { type: 'string', description: 'Re-link to different goal (or null to unlink)' },
        declaredFiles: { type: 'array', items: { type: 'string' } },
        isDeferred: { type: 'boolean' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_link_dependencies',
    description: 'Link one or more prerequisite blocker tasks to a task with cycle validation.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task that will be blocked' },
        dependsOnTaskIds: { type: 'array', items: { type: 'string' }, description: 'Prerequisite blocker task IDs' },
      },
      required: ['taskId', 'dependsOnTaskIds'],
    },
  },
  {
    name: 'moo_unlink_dependencies',
    description: 'Unlink a prerequisite blocker task from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        dependsOnTaskId: { type: 'string', description: 'Blocker task ID to remove' },
      },
      required: ['taskId', 'dependsOnTaskId'],
    },
  },
  {
    name: 'moo_get_next_task',
    description: 'Auto-surface the next unblocked, highest-priority task ready for execution from the active ready queue, with optional file conflict avoidance for parallel agent swarms.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Optional goal ID filter' },
        agentId: { type: 'string', description: 'Optional agent identifier' },
        avoidFileConflicts: { type: 'boolean', description: 'If true, skips candidate tasks that share declared files with active in-flight claims (default: false)' },
      },
    },
  },
  {
    name: 'moo_get_task',
    description: 'Retrieve full task details, subtasks, dependencies, notes, and evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_list_tasks',
    description: 'List and filter tasks by goal, status, priority, type, tag, agent, deferred state, or search text.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human', 'done', 'dropped'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'] },
        tag: { type: 'string', description: 'Filter tasks containing this tag' },
        claimedByAgent: { type: 'string' },
        isDeferred: { type: 'boolean' },
        searchQuery: { type: 'string' },
      },
    },
  },

  // 3. Claims & Ownership
  {
    name: 'moo_claim_task',
    description: 'Claim a task exclusively before starting work. Verifies lease, agent concurrency limit, loop count, and file touch conflicts.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to claim' },
        agentId: { type: 'string', description: 'Unique agent identifier' },
        sessionId: { type: 'string', description: 'Agent conversation/session ID' },
        leaseDurationSeconds: { type: 'number', description: 'Lease timeout in seconds (default: 300)' },
        declaredFiles: { type: 'array', items: { type: 'string' }, description: 'Files this agent will modify' },
      },
      required: ['taskId', 'agentId', 'sessionId'],
    },
  },
  {
    name: 'moo_heartbeat_task',
    description: 'Renew active lease on claimed task while performing long-running work.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' },
        extensionSeconds: { type: 'number', description: 'Seconds to extend lease by (default: 300)' },
      },
      required: ['taskId', 'agentId'],
    },
  },
  {
    name: 'moo_release_task',
    description: 'Voluntarily release a claimed task back to the todo queue with optional progress notes.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' },
        notes: { type: 'string', description: 'Notes on progress or reasons for release' },
      },
      required: ['taskId', 'agentId'],
    },
  },
  {
    name: 'moo_handoff_task',
    description: 'Handoff an in-flight claimed task from one agent to another with handoff summary.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        fromAgentId: { type: 'string' },
        toAgentId: { type: 'string' },
        handoffSummary: { type: 'string', description: 'Summary of what was done and what remains' },
        sessionId: { type: 'string' },
      },
      required: ['taskId', 'fromAgentId', 'toAgentId', 'handoffSummary', 'sessionId'],
    },
  },

  // 4. Completion & Proof
  {
    name: 'moo_complete_task',
    description: 'Close a task with mandatory proof of work: commands run, output logs, modified files, and test proofs. Optionally auto-claim next unblocked task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' },
        evidence: {
          type: 'object',
          properties: {
            commandsRun: { type: 'array', items: { type: 'string' } },
            outputSnippet: { type: 'string' },
            filesModified: { type: 'array', items: { type: 'string' } },
            testProof: { type: 'string' },
            notes: { type: 'string' },
          },
        },
        notes: { type: 'string' },
        autoClaimNext: { type: 'boolean', description: 'If true, atomically claims next unblocked task in goal upon completion' },
        sessionId: { type: 'string', description: 'Agent conversation/session ID for auto-claiming next task' },
        nextDeclaredFiles: { type: 'array', items: { type: 'string' }, description: 'Declared files for next claimed task' },
        nextLeaseSeconds: { type: 'number', description: 'Lease timeout in seconds for next claimed task' },
      },
      required: ['taskId', 'agentId', 'evidence'],
    },
  },
  {
    name: 'moo_complete_and_claim_next',
    description: 'Atomically complete a task with proof and immediately claim the next unblocked ready task under the same goal in a single LLM tool call.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to complete' },
        agentId: { type: 'string', description: 'Agent ID completing and claiming' },
        sessionId: { type: 'string', description: 'Agent session ID for the claim lease' },
        evidence: {
          type: 'object',
          properties: {
            commandsRun: { type: 'array', items: { type: 'string' } },
            outputSnippet: { type: 'string' },
            filesModified: { type: 'array', items: { type: 'string' } },
            testProof: { type: 'string' },
            notes: { type: 'string' },
          },
        },
        notes: { type: 'string', description: 'Optional completion notes' },
        nextDeclaredFiles: { type: 'array', items: { type: 'string' }, description: 'Declared files for the next claimed task' },
        nextLeaseSeconds: { type: 'number', description: 'Lease seconds for the next claimed task (default: 300)' },
      },
      required: ['taskId', 'agentId', 'sessionId', 'evidence'],
    },
  },
  {
    name: 'moo_verify_task',
    description: 'Mark a task verified done by human or verification subagent.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        verifierId: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['taskId', 'verifierId'],
    },
  },
  {
    name: 'moo_reject_task',
    description: 'Reject a closed task with a mandatory reason, moving it back to todo and incrementing reopen counter.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        rejecterId: { type: 'string' },
        reason: { type: 'string', description: 'Mandatory reason for rejection' },
      },
      required: ['taskId', 'rejecterId', 'reason'],
    },
  },

  // 5. Blocking & Human Collaboration
  {
    name: 'moo_ask_human',
    description: 'Escalate a question/blocker to the human user with optional selectable choices and transition task to waiting-on-human.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        agentId: { type: 'string' },
        question: { type: 'string', description: 'Question or decision needed from the human' },
        questionType: { type: 'string', enum: ['clarification', 'approval', 'credential', 'decision'] },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional selectable multi-choice options for 1-click human resolution in the Web UI',
        },
      },
      required: ['taskId', 'agentId', 'question'],
    },
  },
  {
    name: 'moo_get_human_inbox',
    description: 'Get the queue of all tasks currently waiting on human answers or decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
      },
    },
  },
  {
    name: 'moo_answer_human',
    description: 'Provide an answer to a task waiting on human guidance, automatically resuming it into the ready queue.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        humanId: { type: 'string' },
        answer: { type: 'string', description: 'The human answer or decision' },
      },
      required: ['taskId', 'humanId', 'answer'],
    },
  },

  // 6. Discovered Work
  {
    name: 'moo_capture_discovered_work',
    description: 'Capture unexpected work found mid-task without dropping current claim. Can be marked must-fix-now (blocker) or deferred.',
    inputSchema: {
      type: 'object',
      properties: {
        currentTaskId: { type: 'string' },
        agentId: { type: 'string' },
        title: { type: 'string' },
        acceptanceCriteria: { type: 'string' },
        isMustFixNow: { type: 'boolean', description: 'If true, blocks current task until fixed; if false, adds to deferred pile' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        declaredFiles: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
      },
      required: ['currentTaskId', 'agentId', 'title', 'acceptanceCriteria', 'isMustFixNow'],
    },
  },

  // 7. Context & Notes
  {
    name: 'moo_add_task_note',
    description: 'Append an immutable, timestamped note to a task (e.g. what was tried, reason for failure, architecture insight).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        authorId: { type: 'string' },
        content: { type: 'string' },
        noteType: { type: 'string', enum: ['general', 'attempt_failure', 'block_reason', 'drop_reason', 'reopen_reason'] },
      },
      required: ['taskId', 'authorId', 'content'],
    },
  },
  {
    name: 'moo_list_task_notes',
    description: 'List all timestamped notes and attempt logs for a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_log_attempt_failure',
    description: 'Log a structured attempt failure note with error snippet, failure category, hypothesis, and next plan. Increments task attempt counter and automatically escalates to human if loop threshold is exceeded.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        agentId: { type: 'string', description: 'Agent ID reporting the failure (default: agent)' },
        errorSnippet: { type: 'string', description: 'Raw error output, stack trace, or test failure snippet' },
        failureCategory: { type: 'string', description: 'Category of failure (e.g. test_failure, syntax_error, type_error, runtime_error)' },
        hypothesis: { type: 'string', description: 'Working hypothesis of root cause' },
        nextAttemptPlan: { type: 'string', description: 'Action plan for next attempt' },
      },
      required: ['taskId', 'errorSnippet'],
    },
  },

  // 8. Lifecycle Corrections & Bulk Actions
  {
    name: 'moo_drop_task',
    description: 'Drop a task with a mandatory reason (no approval step required).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string', description: 'Mandatory reason for dropping the task' },
        authorId: { type: 'string' },
      },
      required: ['taskId', 'reason'],
    },
  },
  {
    name: 'moo_reopen_task',
    description: 'Reopen a done or dropped task without losing history, incrementing reopen counter.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string' },
        authorId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_undo_status_change',
    description: 'Undo the last status transition for a task, rolling back to its previous state.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        authorId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'moo_bulk_drop_tasks',
    description: 'Drop multiple tasks in a single operation with a shared mandatory reason.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Array of task IDs to drop' },
        reason: { type: 'string', description: 'Mandatory reason for dropping the tasks' },
        authorId: { type: 'string' },
      },
      required: ['taskIds', 'reason'],
    },
  },
  {
    name: 'moo_bulk_reopen_tasks',
    description: 'Reopen multiple done or dropped tasks back into the todo queue.',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Array of task IDs to reopen' },
        reason: { type: 'string' },
        authorId: { type: 'string' },
      },
      required: ['taskIds'],
    },
  },

  // 9. Decisions
  {
    name: 'moo_record_decision',
    description: 'Record a project-level architectural decision with rationale that outlives individual tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        context: { type: 'string' },
        choice: { type: 'string' },
        rationale: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        authorId: { type: 'string' },
      },
      required: ['title', 'context', 'choice', 'rationale'],
    },
  },
  {
    name: 'moo_list_decisions',
    description: 'List project architectural decisions so settled questions stay settled during planning.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['proposed', 'accepted', 'superseded', 'rejected'] },
        tag: { type: 'string' },
      },
    },
  },
  {
    name: 'moo_supersede_decision',
    description: 'Supersede an existing architectural decision with a new choice and rationale.',
    inputSchema: {
      type: 'object',
      properties: {
        oldDecisionId: { type: 'string' },
        newTitle: { type: 'string' },
        newContext: { type: 'string' },
        newChoice: { type: 'string' },
        newRationale: { type: 'string' },
        reason: { type: 'string', description: 'Mandatory reason for superseding' },
        authorId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['oldDecisionId', 'newTitle', 'newContext', 'newChoice', 'newRationale', 'reason'],
    },
  },

  // 10. Merge & Continuity
  {
    name: 'moo_merge_tasks',
    description: 'Merge two tasks that turn out to be duplicates, moving dependencies and subtasks.',
    inputSchema: {
      type: 'object',
      properties: {
        targetTaskId: { type: 'string', description: 'Task to keep' },
        sourceTaskId: { type: 'string', description: 'Task to merge into target and mark dropped' },
        reason: { type: 'string' },
        authorId: { type: 'string' },
      },
      required: ['targetTaskId', 'sourceTaskId'],
    },
  },
  {
    name: 'moo_session_resume',
    description: 'Where-did-I-leave-off overview on session start: surfaces abandoned doing tasks, waiting-on-human, ready queue, settled decisions, and orphan tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
      },
    },
  },
  {
    name: 'moo_get_compact_context',
    description: 'Ultra-dense token-optimized context block with active goal, claimed task, acceptance criteria, settled decisions, and file locks. Ideal for system prompt injection.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Optional agent ID filter' },
        verbosity: { type: 'string', enum: ['ultra-dense', 'standard', 'full'], description: 'Context detail level (default: standard)' },
      },
    },
  },
  {
    name: 'moo_check_file_lock',
    description: 'Pre-check if specific files are currently locked by another agent holding an active claim, preventing edit collisions.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to verify' },
        agentId: { type: 'string', description: 'Agent ID performing the edit' },
      },
      required: ['filePaths'],
    },
  },
  {
    name: 'moo_search',
    description: 'Full-text ranked search (SQLite FTS5) across tasks, acceptance criteria, and architectural decisions (ADR).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or keyword expression' },
        type: { type: 'string', enum: ['all', 'tasks', 'decisions'], description: 'Filter search scope (default: all)' },
        limit: { type: 'number', description: 'Maximum results to return (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'moo_get_file_context',
    description: 'Retrieve file-centric historical context: active file locks, past completed tasks, recent notes, and relevant architectural decisions for specific files before modifying code.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: 'Array of file or directory paths to inspect' },
      },
      required: ['filePaths'],
    },
  },
  {
    name: 'moo_quick_start',
    description: 'Fast-path vibe coding tool: Atomically creates a task under a goal and claims it exclusively in a single round-trip, setting declared files, type, tags, and lease duration.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string', description: 'Goal ID to anchor this task under' },
        title: { type: 'string', description: 'Clean descriptive task title — no priority/category prefixes (use priority, type, tags fields)' },
        acceptanceCriteria: { type: 'string', description: 'Definition of done in Markdown (mandatory)' },
        type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'test', 'docs', 'chore', 'spike', 'security'], description: 'Task category type (default: feature)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Array of contextual tag labels' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority level (default: medium)' },
        declaredFiles: { type: 'array', items: { type: 'string' }, description: 'Files you will modify to detect file collisions' },
        description: { type: 'string', description: 'Optional detailed description' },
        agentId: { type: 'string', description: 'Agent identifier claiming the task (default: agent)' },
        sessionId: { type: 'string', description: 'Session ID' },
        leaseDurationMinutes: { type: 'number', description: 'Lease timeout in minutes (default: 5)' },
      },
      required: ['goalId', 'title', 'acceptanceCriteria'],
    },
  },
  {
    name: 'moo_checkpoint',
    description: 'Fast progress checkpoint: Appends a timestamped progress note to the in-flight task and optionally extends lease heartbeat in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Active in-flight task ID' },
        note: { type: 'string', description: 'Progress note / thought snippet' },
        agentId: { type: 'string', description: 'Agent identifier (default: agent)' },
        heartbeat: { type: 'boolean', description: 'Whether to extend lease timeout (default: true)' },
      },
      required: ['taskId', 'note'],
    },
  },
  {
    name: 'moo_import_markdown',
    description: 'Parse a markdown plan, PRD, or task checklist into a Goal and atomic Tasks with dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown content containing task checklists, phases, and criteria' },
        goalId: { type: 'string', description: 'Optional existing Goal ID to attach tasks under' },
        goalTitle: { type: 'string', description: 'Optional Goal title' },
        sequentialPhases: { type: 'boolean', description: 'Whether to link phase transitions as dependencies (default: true)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'moo_export_project',
    description: 'Export all goals, tasks, notes, and decisions in Markdown, JSON, or Plain Text format.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'json', 'text'] },
      },
    },
  },
  {
    name: 'moo_archive_completed',
    description: 'Archive completed and dropped tasks out of the active working list.',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
      },
    },
  },
  // Workspaces
  {
    name: 'moo_list_workspaces',
    description: 'List all registered project workspaces in the global Moo Tasks registry with their paths and git remotes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'moo_get_workspace',
    description: 'Get details of the active workspace or a specific workspace by ID, name, or folder path.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Optional workspace ID, name, or path (defaults to active project)' },
      },
    },
  },
  {
    name: 'moo_register_workspace',
    description: 'Register a new project directory as a workspace in the global Moo Tasks database.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Absolute or relative directory path of the project' },
        name: { type: 'string', description: 'Optional custom workspace name (defaults to folder name)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'moo_update_workspace',
    description: "Update a workspace's display name or git remote URL.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID, name, or path (defaults to active project)' },
        name: { type: 'string', description: 'New display name' },
        gitRemote: { type: 'string', description: 'New git remote URL' },
      },
    },
  },
  {
    name: 'moo_delete_workspace',
    description: 'Unregister/delete a workspace from the global registry.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace ID, name, or path to delete' },
      },
      required: ['workspaceId'],
    },
  },
];
