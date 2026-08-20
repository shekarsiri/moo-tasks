import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ServiceContainer } from '../services/index.js';
import { DependencyGraph } from '../domain/dependency.js';

export function setupMcpServer(container: ServiceContainer): Server {
  const server = new Server(
    {
      name: 'moo-tasks',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        // Goals
        case 'moo_create_goal': {
          const schema = z.object({
            title: z.string(),
            verbatimPrompt: z.string(),
            description: z.string().optional(),
            maxOpenTasksCap: z.number().optional(),
            workspaceId: z.string().optional(),
          });
          const parsed = schema.parse(args);
          const goal = container.goalService.createGoal(
            parsed.title,
            parsed.verbatimPrompt,
            container.projectPath,
            parsed.maxOpenTasksCap,
            parsed.description,
            parsed.workspaceId || container.activeWorkspace?.id
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    goal,
                    hint: `Goal created. Call moo_create_task(goalId: '${goal.id}', ...) to add tasks.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_get_goal': {
          const { goalId } = args as any;
          const goal = container.goalService.getGoal(goalId);
          const summary = container.goalService.getGoalStatus(goalId);
          const tasks = container.taskRepo.listByGoalId(goalId).filter((t) => !t.isArchived);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, goal, summary, tasks }, null, 2),
              },
            ],
          };
        }

        case 'moo_update_goal': {
          const { goalId, title, description, verbatimPrompt, maxOpenTasksCap, status } = args as any;
          const goal = container.goalService.updateGoal(goalId, {
            title,
            description,
            verbatimPrompt,
            maxOpenTasksCap,
            status,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, goal, hint: 'Goal updated.' }, null, 2),
              },
            ],
          };
        }

        case 'moo_list_goals': {
          const status = (args as any).status;
          const goals = container.goalService.listGoals(container.projectPath, status);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: goals.length, goals }, null, 2) }] };
        }

        case 'moo_get_goal_status': {
          const goalId = (args as any).goalId;
          const summary = container.goalService.getGoalStatus(goalId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, summary }, null, 2) }] };
        }

        case 'moo_kill_goal': {
          const { goalId, reason, authorId } = args as any;
          const result = container.goalService.killGoal(goalId, reason, authorId || 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
        }

        case 'moo_reopen_goal': {
          const { goalId, reopenTasks } = args as any;
          const goal = container.goalService.reopenGoal(goalId, 'agent', reopenTasks !== false);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, goal }, null, 2) }] };
        }

        // Tasks
        case 'moo_create_task': {
          const rawFiles = (args as any).declaredFiles;
          const declaredFiles = rawFiles ? (Array.isArray(rawFiles) ? rawFiles : [rawFiles]) : undefined;
          const rawTags = (args as any).tags;
          const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : undefined;
          const rawDeps = (args as any).dependsOnTaskIds || (args as any).dependsOnTaskId;
          const dependsOnTaskIds = rawDeps ? (Array.isArray(rawDeps) ? rawDeps : [rawDeps].filter(Boolean)) : undefined;

          const res = container.taskLifecycleService.createTask(
            {
              workspaceId: (args as any).workspaceId || container.activeWorkspace?.id,
              ...(args as any),
              declaredFiles,
              tags,
              dependsOnTaskIds,
            },
            (args as any).authorId || 'agent',
            'agent'
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    ...res,
                    hint: `Task created (${res.task.id}). Call moo_claim_task(taskId: '${res.task.id}', agentId: '...', sessionId: '...') before modifying codebase.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_create_tasks_batch': {
          const rawTasks = (args as any).tasks || [];
          const tasks = (Array.isArray(rawTasks) ? rawTasks : [rawTasks]).map((t: any) => {
            const rawFiles = t.declaredFiles;
            const declaredFiles = rawFiles ? (Array.isArray(rawFiles) ? rawFiles : [rawFiles]) : undefined;
            const rawTags = t.tags;
            const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : undefined;
            const rawDeps = t.dependsOnTaskIds || t.dependsOnTaskId;
            const dependsOnTaskIds = rawDeps ? (Array.isArray(rawDeps) ? rawDeps : [rawDeps].filter(Boolean)) : undefined;
            return {
              workspaceId: t.workspaceId || container.activeWorkspace?.id,
              ...t,
              declaredFiles,
              tags,
              dependsOnTaskIds,
            };
          });
          const results = container.taskLifecycleService.createBatch(tasks, 'agent', 'agent');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    createdCount: results.length,
                    tasks: results,
                    hint: `Batch created ${results.length} tasks. Use moo_get_next_task() to pick the highest priority unblocked task.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_update_task': {
          const { taskId, declaredFiles: rawFiles, tags: rawTags, ...updates } = args as any;
          const declaredFiles = rawFiles ? (Array.isArray(rawFiles) ? rawFiles : [rawFiles]) : undefined;
          const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : undefined;
          const updated = container.taskLifecycleService.updateTask(taskId, {
            ...updates,
            ...(declaredFiles !== undefined ? { declaredFiles } : {}),
            ...(tags !== undefined ? { tags } : {}),
          });
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: updated }, null, 2) }] };
        }

        case 'moo_link_dependencies': {
          const { taskId, dependsOnTaskIds, dependsOnTaskId } = args as any;
          const rawDeps = dependsOnTaskIds || dependsOnTaskId;
          const depsList = Array.isArray(rawDeps) ? rawDeps : [rawDeps].filter(Boolean);
          for (const depId of depsList) {
            container.taskLifecycleService.addDependency(taskId, depId);
          }
          const task = container.taskLifecycleService.getTask(taskId);
          const currentDeps = container.taskRepo.getDependencies(taskId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, taskId, dependencies: currentDeps, status: task.status }, null, 2),
              },
            ],
          };
        }

        case 'moo_unlink_dependencies': {
          const { taskId, dependsOnTaskId } = args as any;
          container.taskLifecycleService.removeDependency(taskId, dependsOnTaskId);
          const task = container.taskLifecycleService.getTask(taskId);
          const currentDeps = container.taskRepo.getDependencies(taskId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, taskId, dependencies: currentDeps, status: task.status }, null, 2),
              },
            ],
          };
        }

        case 'moo_get_next_task': {
          const { goalId, agentId, avoidFileConflicts } = args as any;
          const next = container.taskLifecycleService.getNextUnblockedTask(goalId, agentId, Boolean(avoidFileConflicts));
          if (next) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      nextTask: next,
                      hint: `Call moo_claim_task(taskId: '${next.id}', agentId: '...', sessionId: '...') to claim and start work.`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Diagnostic context when queue has no unblocked items
          const allTasks = container.taskRepo.list(goalId ? { goalId } : {});
          const blockedCount = allTasks.filter((t) => t.status === 'blocked-on-dependency').length;
          const doingCount = allTasks.filter((t) => t.status === 'doing').length;
          const waitingHumanCount = allTasks.filter((t) => t.status === 'waiting-on-human').length;
          const doneCount = allTasks.filter((t) => t.status === 'done').length;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    nextTask: null,
                    diagnostics: {
                      message: 'No unblocked todo tasks available in the ready queue.',
                      activeDoingTasks: doingCount,
                      blockedOnDependencies: blockedCount,
                      waitingOnHuman: waitingHumanCount,
                      completedTasks: doneCount,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_get_task': {
          const { taskId } = args as any;
          const task = container.taskLifecycleService.getTask(taskId);
          const subtasks = container.taskRepo.listSubtasks(taskId);
          const dependencies = container.taskRepo.getDependencies(taskId);
          const dependents = container.taskRepo.getDependents(taskId);
          const notes = container.noteRepo.listByTaskId(taskId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, task, subtasks, dependencies, dependents, notes }, null, 2),
              },
            ],
          };
        }

        case 'moo_list_tasks': {
          const tasks = container.taskRepo.list(args as any);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: tasks.length, tasks }, null, 2) }] };
        }

        // Claims
        case 'moo_claim_task': {
          const { taskId, agentId, sessionId, leaseDurationSeconds, declaredFiles: rawFiles } = args as any;
          const aid = agentId || 'agent';
          const sid = sessionId || `sess-${Date.now()}`;
          const declaredFiles = rawFiles ? (Array.isArray(rawFiles) ? rawFiles : [rawFiles]) : undefined;
          const res = container.claimService.claimTask(taskId, aid, sid, {
            leaseDurationSeconds,
            declaredFiles,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    ...res,
                    hint: `Task claimed exclusively until ${res.task.leaseExpiresAt}. Modify code, then call moo_complete_task(taskId: '${taskId}', agentId: '${aid}', evidence: { commandsRun, testProof, ... }) to complete.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_heartbeat_task': {
          const { taskId, agentId, extensionSeconds } = args as any;
          const task = container.taskRepo.findById(taskId);
          const aid = agentId || task?.claimedByAgent || 'agent';
          const updated = container.claimService.heartbeatTask(taskId, aid, extensionSeconds);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: updated }, null, 2) }] };
        }

        case 'moo_release_task': {
          const { taskId, agentId, notes } = args as any;
          const task = container.taskRepo.findById(taskId);
          const aid = agentId || task?.claimedByAgent || 'agent';
          const updated = container.claimService.releaseTask(taskId, aid, notes);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: updated }, null, 2) }] };
        }

        case 'moo_handoff_task': {
          const { taskId, fromAgentId, toAgentId, handoffSummary, sessionId } = args as any;
          const task = container.claimService.handoffTask(
            taskId,
            fromAgentId || 'agent',
            toAgentId || 'agent-next',
            handoffSummary || 'Handoff task',
            sessionId || `sess-${Date.now()}`
          );
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        // Completion & Verification
        case 'moo_complete_task': {
          const { taskId, agentId, evidence, notes, autoClaimNext, sessionId, nextDeclaredFiles, nextLeaseSeconds } = args as any;
          const currentTask = container.taskRepo.findById(taskId);
          const aid = agentId || currentTask?.claimedByAgent || 'agent';

          if (autoClaimNext) {
            const res = container.verificationService.completeAndClaimNext(
              taskId,
              aid,
              sessionId || `sess-${Date.now()}`,
              evidence || {},
              {
                notes,
                nextClaimOptions: {
                  declaredFiles: nextDeclaredFiles,
                  leaseDurationSeconds: nextLeaseSeconds,
                },
              }
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true, ...res }, null, 2),
                },
              ],
            };
          }

          const task = container.verificationService.completeTask(taskId, aid, evidence || {}, notes);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    task,
                    hint: `Task completed and proof logged. Call moo_get_next_task() to continue next ready task.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_complete_and_claim_next': {
          const { taskId, agentId, sessionId, evidence, notes, nextDeclaredFiles, nextLeaseSeconds } = args as any;
          const currentTask = container.taskRepo.findById(taskId);
          const aid = agentId || currentTask?.claimedByAgent || 'agent';
          const res = container.verificationService.completeAndClaimNext(
            taskId,
            aid,
            sessionId || `sess-${Date.now()}`,
            evidence || {},
            {
              notes,
              nextClaimOptions: {
                declaredFiles: nextDeclaredFiles,
                leaseDurationSeconds: nextLeaseSeconds,
              },
            }
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, ...res }, null, 2),
              },
            ],
          };
        }

        case 'moo_verify_task': {
          const { taskId, verifierId, notes } = args as any;
          const task = container.verificationService.verifyTask(taskId, verifierId || 'verifier', 'human', notes);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_reject_task': {
          const { taskId, rejecterId, reason } = args as any;
          const task = container.verificationService.rejectTask(taskId, rejecterId || 'reviewer', 'human', reason);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        // Human Collab
        case 'moo_ask_human': {
          const { taskId, agentId, question, questionType, options } = args as any;
          const currentTask = container.taskRepo.findById(taskId);
          const aid = agentId || currentTask?.claimedByAgent || 'agent';
          const task = container.humanCollabService.askHuman(taskId, aid, question, questionType, options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    task,
                    hint: `Task transitioned to waiting-on-human. The human operator will see the question in their attention inbox.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_get_human_inbox': {
          const { goalId } = args as any;
          const inbox = container.humanCollabService.getHumanInbox(goalId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: inbox.length, inbox }, null, 2) }] };
        }

        case 'moo_answer_human': {
          const { taskId, humanId, answer } = args as any;
          const task = container.humanCollabService.answerHuman(taskId, humanId || 'human', answer);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        // Discovered Work
        case 'moo_capture_discovered_work': {
          const res = container.discoveredWorkService.captureWork(args as any);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...res }, null, 2) }] };
        }

        // Notes
        case 'moo_add_task_note': {
          const { taskId, authorId, content, noteType } = args as any;
          const note = container.noteRepo.create({
            id: `note-${Math.random().toString(36).slice(2, 9)}`,
            taskId,
            authorType: 'agent',
            authorId: authorId || 'agent',
            noteType: noteType || 'general',
            content,
            createdAt: new Date().toISOString(),
          });
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, note }, null, 2) }] };
        }

        case 'moo_list_task_notes': {
          const { taskId } = args as any;
          const notes = container.noteRepo.listByTaskId(taskId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: notes.length, notes }, null, 2) }] };
        }

        case 'moo_log_attempt_failure': {
          const { taskId, agentId, errorSnippet, failureCategory, hypothesis, nextAttemptPlan } = args as any;
          const result = container.taskLifecycleService.logAttemptFailure({
            taskId,
            agentId: agentId || 'agent',
            errorSnippet,
            failureCategory,
            hypothesis,
            nextAttemptPlan,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    ...result,
                    hint: result.autoEscalatedToHuman
                      ? `Task escalated to human review due to exceeding max attempts (${result.task.maxAttemptsAllowed}).`
                      : `Attempt #${result.attemptCount} failure logged. Proceed with next attempt.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Lifecycle & Undo
        case 'moo_drop_task': {
          const { taskId, reason, authorId } = args as any;
          const task = container.taskLifecycleService.dropTask(taskId, reason, authorId || 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_reopen_task': {
          const { taskId, reason, authorId } = args as any;
          const task = container.taskLifecycleService.reopenTask(taskId, reason, authorId || 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_undo_status_change': {
          const { taskId, authorId } = args as any;
          const task = container.taskLifecycleService.undoStatusChange(taskId, authorId || 'agent', 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_bulk_drop_tasks': {
          const { taskIds, reason, authorId } = args as any;
          const ids = Array.isArray(taskIds) ? taskIds : [taskIds].filter(Boolean);
          const droppedCount = container.taskLifecycleService.bulkDrop(ids, reason, authorId || 'agent', 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, droppedCount, taskIds: ids }, null, 2) }] };
        }

        case 'moo_bulk_reopen_tasks': {
          const { taskIds, reason, authorId } = args as any;
          const ids = Array.isArray(taskIds) ? taskIds : [taskIds].filter(Boolean);
          const reopenedCount = container.taskLifecycleService.bulkReopen(ids, reason || 'Bulk reopen', authorId || 'agent', 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, reopenedCount, taskIds: ids }, null, 2) }] };
        }

        // Decisions
        case 'moo_record_decision': {
          const { title, context, choice, rationale, tags: rawTags, authorId, workspaceId } = args as any;
          const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : [];
          const dec = container.decisionService.recordDecision({
            workspaceId: workspaceId || container.activeWorkspace?.id,
            title,
            context,
            choice,
            rationale,
            tags,
            projectPath: container.projectPath,
            authorId: authorId || 'agent',
          });
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, decision: dec }, null, 2) }] };
        }

        case 'moo_list_decisions': {
          const { status, tag, workspaceId } = args as any;
          const targetWs = workspaceId || container.activeWorkspace?.id;
          const decisions = targetWs
            ? container.decisionService.listDecisions(undefined, status, tag, targetWs)
            : container.decisionService.listDecisions(container.projectPath, status, tag);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: decisions.length, decisions }, null, 2) }] };
        }

        case 'moo_supersede_decision': {
          const { oldDecisionId, newTitle, newContext, newChoice, newRationale, reason, authorId, tags, workspaceId } = args as any;
          const res = container.decisionService.supersedeDecision(
            oldDecisionId,
            {
              workspaceId: workspaceId || container.activeWorkspace?.id,
              title: newTitle,
              context: newContext,
              choice: newChoice,
              rationale: newRationale,
              tags,
              projectPath: container.projectPath,
              authorId: authorId || 'agent',
            },
            reason
          );
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...res }, null, 2) }] };
        }

        // Merge & Continuity
        case 'moo_merge_tasks': {
          const { targetTaskId, sourceTaskId, reason, authorId } = args as any;
          const res = container.duplicateMergeService.mergeTasks(targetTaskId, sourceTaskId, authorId || 'agent', reason);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...res }, null, 2) }] };
        }

        case 'moo_session_resume': {
          const { agentId } = args as any;
          const summary = container.sessionService.whereDidILeaveOff(container.projectPath, agentId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, summary }, null, 2) }] };
        }

        case 'moo_get_compact_context': {
          const { agentId, verbosity } = args as any;
          const compact = container.sessionService.getCompactContext(container.projectPath, agentId, verbosity || 'standard');
          return { content: [{ type: 'text', text: compact }] };
        }

        case 'moo_check_file_lock': {
          const rawFiles = (args as any).filePaths || (args as any).files || [];
          const filePaths = Array.isArray(rawFiles) ? rawFiles : [rawFiles].filter(Boolean);
          const { agentId } = args as any;
          const fileContext = container.sessionService.getFileContext(filePaths, container.projectPath);
          const otherAgentLocks = fileContext.activeLocks.filter((l) => !agentId || l.claimedByAgent !== agentId);
          const isLockedByOther = otherAgentLocks.length > 0;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    canEdit: !isLockedByOther,
                    isLockedByOther,
                    activeLocks: fileContext.activeLocks,
                    hint: isLockedByOther
                      ? `Conflict Warning: Files are actively claimed by ${otherAgentLocks.map((l) => l.claimedByAgent).join(', ')}. Coordinate with agent or wait for lease expiration.`
                      : 'Files are free to edit.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_search': {
          const { query, type, limit } = args as any;
          const searchResults = container.searchService.search(query, { type, limit });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, ...searchResults }, null, 2),
              },
            ],
          };
        }

        case 'moo_get_file_context': {
          const rawFiles = (args as any).filePaths || (args as any).files || [];
          const filePaths = Array.isArray(rawFiles) ? rawFiles : [rawFiles].filter(Boolean);
          const fileContext = container.sessionService.getFileContext(filePaths, container.projectPath);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, ...fileContext }, null, 2),
              },
            ],
          };
        }

        case 'moo_quick_start': {
          const { goalId, title, acceptanceCriteria, priority, type, tags: rawTags, declaredFiles, description, agentId, sessionId, leaseDurationMinutes, workspaceId } = args as any;
          const aid = agentId || 'agent';
          const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : undefined;
          const created = container.taskLifecycleService.createTask(
            {
              workspaceId: workspaceId || container.activeWorkspace?.id,
              goalId,
              title,
              acceptanceCriteria,
              priority: priority || 'medium',
              type: type || 'feature',
              tags: tags || [],
              declaredFiles,
              description,
            },
            aid,
            'agent'
          );

          const claimed = container.claimService.claimTask(
            created.task.id,
            aid,
            sessionId || `sess-${Date.now()}`,
            {
              declaredFiles,
              leaseDurationSeconds: (leaseDurationMinutes || 5) * 60,
            }
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                task: claimed.task,
                conflictWarnings: claimed.conflictWarnings,
                relatedDecisions: claimed.relatedDecisions || [],
                hint: `Task ${claimed.task.id} created and exclusively claimed. You may proceed with implementation.`,
              }, null, 2)
            }],
          };
        }

        case 'moo_checkpoint': {
          const { taskId, note, agentId, heartbeat } = args as any;
          const taskObj = container.taskRepo.findById(taskId);
          const aid = agentId || taskObj?.claimedByAgent || 'agent';
          if (heartbeat !== false && taskObj?.claimedByAgent) {
            container.claimService.heartbeatTask(taskId, aid);
          }

          const savedNote = container.noteRepo.create({
            id: `note-${Math.random().toString(36).slice(2, 9)}`,
            taskId,
            authorType: 'agent',
            authorId: aid,
            noteType: 'attempt_log',
            content: note,
            createdAt: new Date().toISOString(),
          });

          const task = container.taskRepo.findById(taskId);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                taskId,
                leaseExpiresAt: task?.leaseExpiresAt,
                noteId: savedNote.id,
                hint: `Checkpoint saved. Task lease extended.`,
              }, null, 2)
            }],
          };
        }

        case 'moo_import_markdown': {
          const { content, goalId, goalTitle, sequentialPhases } = args as any;
          const result = container.markdownImportService.importMarkdown(content, {
            goalId,
            goalTitle,
            projectPath: container.projectPath,
            sequentialPhases: sequentialPhases !== false,
            authorId: 'agent',
            authorType: 'agent',
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    goal: result.goal,
                    importedCount: result.importedCount,
                    tasks: result.tasks,
                    hint: `Successfully imported ${result.importedCount} tasks from markdown plan.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_export_project': {
          const { format } = args as any;
          const output = container.housekeepingService.exportProject(container.projectPath, format || 'markdown');
          return { content: [{ type: 'text', text: output }] };
        }

        case 'moo_archive_completed': {
          const { goalId } = args as any;
          const count = container.housekeepingService.archiveCompleted(goalId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, archivedCount: count }, null, 2) }] };
        }

        // Workspaces
        case 'moo_list_workspaces': {
          const workspaces = container.workspaceService.listWorkspaces();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    activeWorkspace: container.activeWorkspace,
                    total: workspaces.length,
                    workspaces,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'moo_get_workspace': {
          const schema = z.object({
            workspaceId: z.string().optional(),
          });
          const parsed = schema.parse(args);
          const ws = parsed.workspaceId
            ? container.workspaceService.getWorkspace(parsed.workspaceId)
            : container.activeWorkspace;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: Boolean(ws), workspace: ws }, null, 2),
              },
            ],
          };
        }

        case 'moo_register_workspace': {
          const schema = z.object({
            projectPath: z.string(),
            name: z.string().optional(),
          });
          const parsed = schema.parse(args);
          const ws = container.workspaceService.getOrCreateWorkspace(parsed.projectPath, parsed.name);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, workspace: ws }, null, 2),
              },
            ],
          };
        }

        case 'moo_update_workspace': {
          const schema = z.object({
            workspaceId: z.string().optional(),
            name: z.string().optional(),
            gitRemote: z.string().optional(),
          });
          const parsed = schema.parse(args);
          const targetId = parsed.workspaceId || container.activeWorkspace.id;
          const updated = container.workspaceService.updateWorkspace(targetId, {
            name: parsed.name,
            gitRemote: parsed.gitRemote,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, workspace: updated }, null, 2),
              },
            ],
          };
        }

        case 'moo_delete_workspace': {
          const schema = z.object({
            workspaceId: z.string(),
          });
          const parsed = schema.parse(args);
          const deleted = container.workspaceService.deleteWorkspace(parsed.workspaceId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: deleted }, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      const code = err.code || (err.name ? err.name : 'TOOL_ERROR');
      let recoveryAction = 'Check input parameters and retry.';

      if (code === 'TASK_BLOCKED_ON_DEPENDENCY') {
        recoveryAction = 'Prerequisites must be completed first. Call moo_get_next_task() to find actionable unblocked tasks or complete blockers.';
      } else if (code === 'TASK_WAITING_ON_HUMAN') {
        recoveryAction = 'This task is paused awaiting human input. Call moo_get_human_inbox() to inspect pending questions or wait for human answer.';
      } else if (code === 'GOAL_CAP_EXCEEDED') {
        recoveryAction = 'Goal open tasks limit reached. Execute and complete existing tasks before creating more.';
      } else if (code === 'TASK_ALREADY_CLAIMED') {
        recoveryAction = 'Another agent holds the lease on this task. Call moo_get_next_task() to work on a different task or wait for lease expiration.';
      } else if (code === 'AGENT_CONCURRENCY_LIMIT') {
        recoveryAction = 'Agent holds maximum simultaneous tasks. Complete or release current task before claiming another.';
      } else if (code === 'MISSING_EVIDENCE') {
        recoveryAction = 'Provide evidence (commandsRun, outputSnippet, testProof, or filesModified) to complete the task.';
      } else if (code === 'SUBTASK_NESTING_LIMIT') {
        recoveryAction = 'Only 1 level of subtasks is permitted. Create task directly under the goal instead.';
      } else if (code === 'DEPENDENCY_CYCLE') {
        recoveryAction = 'Circular dependency detected. Remove conflicting dependency links.';
      }

      const errorPayload = {
        success: false,
        error: err.message || String(err),
        code,
        recoveryAction,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
        isError: true,
      };
    }
  });

  // --- MCP Native Resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'moo://context/compact',
          name: 'Compact Context',
          description: 'Ultra-dense token-optimized summary of active goal, claimed task, decisions, and file locks',
          mimeType: 'text/markdown',
        },
        {
          uri: 'moo://goals/active',
          name: 'Active Goals',
          description: 'Active project goals with rich Markdown PRD/specs, task metrics, and completion state',
          mimeType: 'text/markdown',
        },
        {
          uri: 'moo://tasks/ready',
          name: 'Ready Queue',
          description: 'All unblocked, actionable tasks currently ready for immediate claim and implementation',
          mimeType: 'application/json',
        },
        {
          uri: 'moo://decisions/settled',
          name: 'Settled Architectural Decisions (ADR)',
          description: 'Project architectural decision records (accepted) preventing re-litigation of designs',
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'moo://context/compact') {
      const text = container.sessionService.getCompactContext(container.projectPath);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    }

    if (uri === 'moo://goals/active') {
      const goals = container.goalService.listGoals(container.projectPath, 'active');
      const lines: string[] = ['# 🎯 Active Project Goals\n'];
      for (const g of goals) {
        const status = container.goalService.getGoalStatus(g.id);
        lines.push(`## [${g.id}] ${g.title}`);
        lines.push(`- **Status**: ${g.status} | **Progress**: ${status.completedTasks}/${status.totalTasks} completed (${status.openTasks} open, max cap: ${g.maxOpenTasksCap})`);
        if (g.verbatimPrompt) lines.push(`- **Original Prompt**: *"${g.verbatimPrompt}"*`);
        if (g.description) lines.push(`\n### Specification\n${g.description}\n`);
        lines.push('---');
      }
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }

    if (uri === 'moo://tasks/ready') {
      const allTasks = container.taskRepo.list({ isArchived: false, isDeferred: false });
      const todoTasks = allTasks.filter((t) => t.status === 'todo');
      const allDeps = container.taskRepo.getAllDependencies();
      const taskMap = new Map(allTasks.map((t) => [t.id, t]));
      const unblocked = todoTasks.filter((t) => DependencyGraph.isTaskUnblocked(t.id, allDeps, taskMap));
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ readyTasks: unblocked, total: unblocked.length }, null, 2),
          },
        ],
      };
    }

    if (uri === 'moo://decisions/settled') {
      const decisions = container.decisionRepo.list(container.projectPath, 'accepted');
      const lines: string[] = ['# 🏛️ Settled Architectural Decision Records (ADR)\n'];
      for (const d of decisions) {
        lines.push(`## [${d.id}] ${d.title}`);
        lines.push(`- **Choice**: \`${d.choice}\``);
        lines.push(`- **Rationale**: ${d.rationale}`);
        if (d.tags && d.tags.length > 0) lines.push(`- **Tags**: ${d.tags.map((t) => `\`${t}\``).join(', ')}`);
        if (d.context) lines.push(`- **Context**: ${d.context}`);
        lines.push('---');
      }
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });

  // --- MCP Native Prompts ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'moo_plan_feature',
          description: 'Interactive prompt guiding an agent to break down a user feature request into atomic tasks anchored to a goal.',
          arguments: [
            {
              name: 'featureRequest',
              description: 'The verbatim feature request from the human user',
              required: true,
            },
          ],
        },
        {
          name: 'moo_execute_next',
          description: 'Workflow prompt guiding an agent to claim the top ready task, implement it, and verify with tests.',
          arguments: [
            {
              name: 'agentId',
              description: 'Agent ID claiming and executing the task',
              required: false,
            },
          ],
        },
        {
          name: 'moo-plan-feature',
          description: 'Alias for moo_plan_feature',
          arguments: [
            {
              name: 'featureRequest',
              description: 'The verbatim feature request from the human user',
              required: true,
            },
          ],
        },
        {
          name: 'moo-execute-next',
          description: 'Alias for moo_execute_next',
          arguments: [
            {
              name: 'agentId',
              description: 'Agent ID claiming and executing the task',
              required: false,
            },
          ],
        },
      ],
    };
  });

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
              text: `You are pair programming with the user. Please plan the following feature using Moo Tasks:\n\n"${featureRequest}"\n\nFollow this workflow:\n1. Call moo_create_goal(title, verbatimPrompt, description) with rich PRD markdown.\n2. Call moo_create_tasks_batch with atomic tasks, complete technical specifications, acceptance criteria, and dependencies.\n3. Call moo_get_compact_context to review the plan before implementation.`,
            },
          },
        ],
      };
    }

    if (name === 'moo_execute_next' || name === 'moo-execute-next') {
      const agentId = (promptArgs as any).agentId || 'agent';
      return {
        description: 'Execute the top unblocked task from Moo Tasks ready queue',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please execute the next ready task in Moo Tasks for agent '${agentId}':\n\n1. Call moo_get_next_task() to inspect the top priority unblocked task.\n2. Call moo_claim_task(taskId, agentId, sessionId, declaredFiles) to acquire a lease.\n3. Implement the feature and write tests.\n4. Call moo_complete_task(taskId, agentId, evidence: { commandsRun, testProof, filesModified }) or moo_complete_and_claim_next to finish.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}
