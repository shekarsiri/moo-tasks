import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ServiceContainer } from '../services/index.js';

export function setupMcpServer(container: ServiceContainer): Server {
  const server = new Server(
    {
      name: 'moo-tasks',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // 1. Goals
        {
          name: 'moo_create_goal',
          description: 'Record a human user request verbatim as an overarching Goal. Tasks will link back to this goal. Caps open tasks to prevent over-planning.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Brief descriptive title for the goal' },
              verbatimPrompt: { type: 'string', description: 'Verbatim text of the human user request' },
              description: { type: 'string', description: 'Full rich Markdown specification, PRD, architectural breakdown, and plan' },
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
          description: 'Create a task under a goal (or standalone) with acceptance criteria, priority, declared files, and dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              goalId: { type: 'string', description: 'Goal ID this task belongs to' },
              parentId: { type: 'string', description: 'Parent Task ID if this is a subtask (max 1 level depth)' },
              acceptanceCriteria: { type: 'string', description: 'Mandatory criteria defining when task is done (written before work starts)' },
              description: { type: 'string', description: 'Detailed task description' },
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
          description: 'Batch create multiple tasks under a goal in a single operation.',
          inputSchema: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    goalId: { type: 'string' },
                    parentId: { type: 'string' },
                    acceptanceCriteria: { type: 'string' },
                    description: { type: 'string' },
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
          description: 'Update task properties: title, description, priority, acceptance criteria, declared files, goal, or deferred state.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'Task ID to update' },
              title: { type: 'string', description: 'Updated title' },
              description: { type: 'string', description: 'Updated description' },
              acceptanceCriteria: { type: 'string', description: 'Updated acceptance criteria' },
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
          description: 'Auto-surface the next unblocked, highest-priority task ready for execution from the active ready queue.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: { type: 'string', description: 'Optional goal ID filter' },
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
          description: 'List and filter tasks by goal, status, priority, agent, deferred state, or search text.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: { type: 'string' },
              status: { type: 'string', enum: ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human', 'done', 'dropped'] },
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
          description: 'Close a task with mandatory proof of work: commands run, output logs, modified files, and test proofs.',
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
            },
            required: ['taskId', 'agentId', 'evidence'],
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
          description: 'Escalate a question/blocker to the human user and transition task to waiting-on-human.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              agentId: { type: 'string' },
              question: { type: 'string', description: 'Question or decision needed from the human' },
              questionType: { type: 'string', enum: ['clarification', 'approval', 'credential', 'decision'] },
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
          description: 'Ultra-dense token-optimized context block (< 400 tokens) with active goal, claimed task, acceptance criteria, settled decisions, and file locks. Ideal for system prompt injection.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Optional agent ID filter' },
            },
          },
        },
        {
          name: 'moo_quick_start',
          description: 'Fast-path vibe coding tool: Atomically creates a task under a goal and claims it exclusively in a single round-trip, setting declared files and lease duration.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: { type: 'string', description: 'Goal ID to anchor this task under' },
              title: { type: 'string', description: 'Task title' },
              acceptanceCriteria: { type: 'string', description: 'Definition of done in Markdown (mandatory)' },
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
          });
          const parsed = schema.parse(args);
          const goal = container.goalService.createGoal(
            parsed.title,
            parsed.verbatimPrompt,
            container.projectPath,
            parsed.maxOpenTasksCap,
            parsed.description
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
          const res = container.taskLifecycleService.createTask(args as any, (args as any).authorId || 'agent', 'agent');
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
          const { tasks } = args as any;
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
          const { taskId, ...updates } = args as any;
          const updated = container.taskLifecycleService.updateTask(taskId, updates);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: updated }, null, 2) }] };
        }

        case 'moo_link_dependencies': {
          const { taskId, dependsOnTaskIds } = args as any;
          for (const depId of dependsOnTaskIds) {
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
          const { goalId } = args as any;
          const next = container.taskLifecycleService.getNextUnblockedTask(goalId);
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
          const { taskId, agentId, sessionId, leaseDurationSeconds, declaredFiles } = args as any;
          const res = container.claimService.claimTask(taskId, agentId, sessionId, {
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
                    hint: `Task claimed exclusively until ${res.task.leaseExpiresAt}. Modify code, then call moo_complete_task(taskId: '${taskId}', agentId: '${agentId}', evidence: { commandsRun, testProof, ... }) to complete.`,
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
          const task = container.claimService.heartbeatTask(taskId, agentId, extensionSeconds);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_release_task': {
          const { taskId, agentId, notes } = args as any;
          const task = container.claimService.releaseTask(taskId, agentId, notes);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_handoff_task': {
          const { taskId, fromAgentId, toAgentId, handoffSummary, sessionId } = args as any;
          const task = container.claimService.handoffTask(taskId, fromAgentId, toAgentId, handoffSummary, sessionId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        // Completion & Verification
        case 'moo_complete_task': {
          const { taskId, agentId, evidence, notes } = args as any;
          const task = container.verificationService.completeTask(taskId, agentId, evidence, notes);
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

        case 'moo_verify_task': {
          const { taskId, verifierId, notes } = args as any;
          const task = container.verificationService.verifyTask(taskId, verifierId, 'human', notes);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        case 'moo_reject_task': {
          const { taskId, rejecterId, reason } = args as any;
          const task = container.verificationService.rejectTask(taskId, rejecterId, 'human', reason);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        }

        // Human Collab
        case 'moo_ask_human': {
          const { taskId, agentId, question, questionType } = args as any;
          const task = container.humanCollabService.askHuman(taskId, agentId, question, questionType);
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
          const task = container.humanCollabService.answerHuman(taskId, humanId, answer);
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
            authorId,
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
          const droppedCount = container.taskLifecycleService.bulkDrop(taskIds, reason, authorId || 'agent', 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, droppedCount, taskIds }, null, 2) }] };
        }

        case 'moo_bulk_reopen_tasks': {
          const { taskIds, reason, authorId } = args as any;
          const reopenedCount = container.taskLifecycleService.bulkReopen(taskIds, reason || 'Bulk reopen', authorId || 'agent', 'agent');
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, reopenedCount, taskIds }, null, 2) }] };
        }

        // Decisions
        case 'moo_record_decision': {
          const { title, context, choice, rationale, tags, authorId } = args as any;
          const dec = container.decisionService.recordDecision({
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
          const { status, tag } = args as any;
          const decisions = container.decisionService.listDecisions(container.projectPath, status, tag);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, total: decisions.length, decisions }, null, 2) }] };
        }

        case 'moo_supersede_decision': {
          const { oldDecisionId, newTitle, newContext, newChoice, newRationale, reason, authorId, tags } = args as any;
          const res = container.decisionService.supersedeDecision(
            oldDecisionId,
            {
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
          const { agentId } = args as any;
          const compact = container.sessionService.getCompactContext(container.projectPath, agentId);
          return { content: [{ type: 'text', text: compact }] };
        }

        case 'moo_quick_start': {
          const { goalId, title, acceptanceCriteria, priority, declaredFiles, description, agentId, sessionId, leaseDurationMinutes } = args as any;
          const aid = agentId || 'agent';
          const created = container.taskLifecycleService.createTask(
            {
              goalId,
              title,
              acceptanceCriteria,
              priority: priority || 'medium',
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
                hint: `Task ${claimed.task.id} created and exclusively claimed. You may proceed with implementation.`,
              }, null, 2)
            }],
          };
        }

        case 'moo_checkpoint': {
          const { taskId, note, agentId, heartbeat } = args as any;
          const aid = agentId || 'agent';
          if (heartbeat !== false) {
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

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
