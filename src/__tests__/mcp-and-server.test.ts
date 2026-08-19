import { describe, it, expect, beforeEach } from 'vitest';
import { createServiceContainer, ServiceContainer } from '../services/index.js';
import { setupMcpServer } from '../mcp/server.js';
import { buildServer } from '../server/app.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

describe('MCP Tools & Fastify HTTP Server', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = createServiceContainer({ inMemory: true, projectPath: '/test/mcp-server' });
  });

  describe('MCP Protocol Server Tools', () => {
    it('lists all registered MCP tools including update, dependencies, and bulk tools', async () => {
      const server = setupMcpServer(container);
      const listHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const res = await listHandler({ method: 'tools/list' });
      expect(res.tools).toBeDefined();
      expect(res.tools.length).toBeGreaterThanOrEqual(23);

      const toolNames = res.tools.map((t: any) => t.name);
      expect(toolNames).toContain('moo_create_goal');
      expect(toolNames).toContain('moo_create_task');
      expect(toolNames).toContain('moo_update_task');
      expect(toolNames).toContain('moo_link_dependencies');
      expect(toolNames).toContain('moo_unlink_dependencies');
      expect(toolNames).toContain('moo_bulk_drop_tasks');
      expect(toolNames).toContain('moo_bulk_reopen_tasks');
      expect(toolNames).toContain('moo_claim_task');
      expect(toolNames).toContain('moo_complete_task');
      expect(toolNames).toContain('moo_ask_human');
      expect(toolNames).toContain('moo_answer_human');
      expect(toolNames).toContain('moo_record_decision');
      expect(toolNames).toContain('moo_session_resume');
    });

    it('executes moo_create_goal, moo_create_task, and moo_claim_task through MCP tool handler', async () => {
      const server = setupMcpServer(container);
      const callTool = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      // 1. Create Goal
      const goalRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_create_goal',
          arguments: {
            title: 'Build Authentication',
            verbatimPrompt: 'Implement JWT login endpoint',
            maxOpenTasksCap: 5,
          },
        },
      });

      const goalData = JSON.parse(goalRes.content[0].text);
      expect(goalData.success).toBe(true);
      expect(goalData.goal.title).toBe('Build Authentication');
      expect(goalData.hint).toContain('moo_create_task');

      // 2. Create Task under goal
      const taskRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_create_task',
          arguments: {
            title: 'Write JWT Signer',
            goalId: goalData.goal.id,
            acceptanceCriteria: 'Unit tests pass for sign and verify',
            declaredFiles: ['src/auth/jwt.ts'],
          },
        },
      });

      const taskData = JSON.parse(taskRes.content[0].text);
      expect(taskData.success).toBe(true);
      expect(taskData.task.title).toBe('Write JWT Signer');
      expect(taskData.hint).toContain('moo_claim_task');

      // 3. Claim Task
      const claimRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_claim_task',
          arguments: {
            taskId: taskData.task.id,
            agentId: 'coder-agent-1',
            sessionId: 'session-xyz',
          },
        },
      });

      const claimData = JSON.parse(claimRes.content[0].text);
      expect(claimData.success).toBe(true);
      expect(claimData.task.status).toBe('doing');
      expect(claimData.task.claimedByAgent).toBe('coder-agent-1');

      // 4. Complete Task with Evidence
      const completeRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_complete_task',
          arguments: {
            taskId: taskData.task.id,
            agentId: 'coder-agent-1',
            evidence: {
              commandsRun: ['npm test jwt.test.ts'],
              testProof: '100% coverage',
            },
          },
        },
      });

      const completeData = JSON.parse(completeRes.content[0].text);
      expect(completeData.success).toBe(true);
      expect(completeData.task.status).toBe('done');
      expect(completeData.task.verificationState).toBe('agent_completed');
    });

    it('handles task updates, dependency linking, and bulk actions via MCP', async () => {
      const server = setupMcpServer(container);
      const callTool = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      // Create two tasks
      const t1 = container.taskLifecycleService.createTask({
        title: 'Prerequisite Core',
        acceptanceCriteria: 'Core implemented',
      });
      const t2 = container.taskLifecycleService.createTask({
        title: 'Dependent Feature',
        acceptanceCriteria: 'Feature implemented',
      });

      // 1. Update task criteria via moo_update_task
      const updateRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_update_task',
          arguments: {
            taskId: t2.task.id,
            title: 'Dependent Feature (Revised)',
            acceptanceCriteria: 'New updated criteria',
            priority: 'critical',
          },
        },
      });
      const updateData = JSON.parse(updateRes.content[0].text);
      expect(updateData.success).toBe(true);
      expect(updateData.task.title).toBe('Dependent Feature (Revised)');
      expect(updateData.task.priority).toBe('critical');

      // 2. Link dependency via moo_link_dependencies
      const linkRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_link_dependencies',
          arguments: {
            taskId: t2.task.id,
            dependsOnTaskIds: [t1.task.id],
          },
        },
      });
      const linkData = JSON.parse(linkRes.content[0].text);
      expect(linkData.success).toBe(true);
      expect(linkData.dependencies).toContain(t1.task.id);
      expect(linkData.status).toBe('blocked-on-dependency');

      // 3. Unlink dependency via moo_unlink_dependencies
      const unlinkRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_unlink_dependencies',
          arguments: {
            taskId: t2.task.id,
            dependsOnTaskId: t1.task.id,
          },
        },
      });
      const unlinkData = JSON.parse(unlinkRes.content[0].text);
      expect(unlinkData.success).toBe(true);
      expect(unlinkData.status).toBe('todo');

      // 4. Bulk drop via moo_bulk_drop_tasks
      const dropRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_bulk_drop_tasks',
          arguments: {
            taskIds: [t1.task.id, t2.task.id],
            reason: 'Architecture pivot',
          },
        },
      });
      const dropData = JSON.parse(dropRes.content[0].text);
      expect(dropData.success).toBe(true);
      expect(dropData.droppedCount).toBe(2);

      // 5. Bulk reopen via moo_bulk_reopen_tasks
      const reopenRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_bulk_reopen_tasks',
          arguments: {
            taskIds: [t1.task.id, t2.task.id],
            reason: 'Resumed scope',
          },
        },
      });
      const reopenData = JSON.parse(reopenRes.content[0].text);
      expect(reopenData.success).toBe(true);
      expect(reopenData.reopenedCount).toBe(2);
    });

    it('executes moo_quick_start, moo_checkpoint, and moo_get_compact_context vibe coding tools', async () => {
      const server = setupMcpServer(container);
      const callTool = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const goal = container.goalService.createGoal('Vibe Feature', 'Build instant search', container.projectPath);

      // 1. moo_quick_start (create + claim in 1 call)
      const quickRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_quick_start',
          arguments: {
            goalId: goal.id,
            title: 'Build Search Input Component',
            acceptanceCriteria: 'Input debounces by 300ms',
            priority: 'high',
            declaredFiles: ['src/ui/search.ts'],
            agentId: 'vibe-agent-1',
          },
        },
      });

      const quickData = JSON.parse(quickRes.content[0].text);
      expect(quickData.success).toBe(true);
      expect(quickData.task.status).toBe('doing');
      expect(quickData.task.claimedByAgent).toBe('vibe-agent-1');
      expect(quickData.task.declaredFiles).toContain('src/ui/search.ts');

      // 2. moo_checkpoint (progress note + heartbeat)
      const checkRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_checkpoint',
          arguments: {
            taskId: quickData.task.id,
            note: 'Implemented debounce helper and tested key events',
            agentId: 'vibe-agent-1',
          },
        },
      });

      const checkData = JSON.parse(checkRes.content[0].text);
      expect(checkData.success).toBe(true);
      expect(checkData.taskId).toBe(quickData.task.id);
      expect(checkData.noteId).toBeDefined();

      // 3. moo_get_compact_context
      const compactRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_get_compact_context',
          arguments: {
            agentId: 'vibe-agent-1',
          },
        },
      });

      const compactText = compactRes.content[0].text;
      expect(compactText).toContain('# 🐮 MOO TASKS CONTEXT');
      expect(compactText).toContain('ACTIVE GOAL');
      expect(compactText).toContain('CURRENT CLAIMED TASK');
      expect(compactText).toContain('Build Search Input Component');
      expect(compactText).toContain('src/ui/search.ts');
    });
  });

  describe('Fastify REST Server Endpoints', () => {
    it('handles REST API calls for goals, tasks, decisions and export', async () => {
      const app = buildServer(container);

      // Create Goal via POST /api/goals
      const goalRes = await app.inject({
        method: 'POST',
        url: '/api/goals',
        payload: {
          title: 'Setup Infrastructure',
          verbatimPrompt: 'Configure SQLite with WAL mode',
          maxOpenTasksCap: 8,
        },
      });

      expect(goalRes.statusCode).toBe(200);
      const goalBody = JSON.parse(goalRes.payload);
      expect(goalBody.goal.title).toBe('Setup Infrastructure');

      // Create Task via POST /api/tasks
      const taskRes = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          title: 'Implement Database Connection',
          goalId: goalBody.goal.id,
          acceptanceCriteria: 'DatabaseManager returns singleton instance',
        },
      });

      expect(taskRes.statusCode).toBe(200);
      const taskBody = JSON.parse(taskRes.payload);
      expect(taskBody.task.title).toBe('Implement Database Connection');

      // GET /api/tasks
      const listTasksRes = await app.inject({
        method: 'GET',
        url: '/api/tasks',
      });
      expect(listTasksRes.statusCode).toBe(200);
      expect(JSON.parse(listTasksRes.payload).total).toBe(1);

      // POST /api/decisions
      const decRes = await app.inject({
        method: 'POST',
        url: '/api/decisions',
        payload: {
          title: 'Use Fastify over Express',
          context: 'Need high performance and built-in async support',
          choice: 'Fastify',
          rationale: 'Lower overhead and native schema validation',
          tags: ['backend', 'http'],
        },
      });
      expect(decRes.statusCode).toBe(200);

      // GET /api/export
      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/export?format=markdown',
      });
      expect(exportRes.statusCode).toBe(200);
      expect(JSON.parse(exportRes.payload).content).toContain('Setup Infrastructure');
    });
  });

  describe('Defensive MCP Input Coercion & CLI Commands', () => {
    it('gracefully handles single-string parameters for dependencies and files', async () => {
      const server = setupMcpServer(container);
      const callTool = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      // Create task with single string for declaredFiles
      const taskRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_create_task',
          arguments: {
            title: 'Defensive Input Task',
            acceptanceCriteria: 'Works with string array coercion',
            declaredFiles: 'src/single-file.ts', // single string instead of array
          },
        },
      });

      const taskData = JSON.parse(taskRes.content[0].text);
      expect(taskData.success).toBe(true);
      expect(Array.isArray(taskData.task.declaredFiles)).toBe(true);
      expect(taskData.task.declaredFiles).toContain('src/single-file.ts');

      // Claim without explicit agentId and sessionId
      const claimRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_claim_task',
          arguments: {
            taskId: taskData.task.id,
          },
        },
      });
      const claimData = JSON.parse(claimRes.content[0].text);
      expect(claimData.success).toBe(true);
      expect(claimData.task.claimedByAgent).toBe('agent');

      // Heartbeat without passing agentId
      const hbRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_heartbeat_task',
          arguments: {
            taskId: taskData.task.id,
          },
        },
      });
      const hbData = JSON.parse(hbRes.content[0].text);
      expect(hbData.success).toBe(true);

      // Checkpoint without passing agentId
      const cpRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_checkpoint',
          arguments: {
            taskId: taskData.task.id,
            note: 'Progress update',
          },
        },
      });
      const cpData = JSON.parse(cpRes.content[0].text);
      expect(cpData.success).toBe(true);
    });

    it('executes atomic moo_complete_and_claim_next transitioning seamlessly to the next unblocked task', async () => {
      const server = setupMcpServer(container);
      const callTool = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

      const goal = container.goalService.createGoal('Multi-step Goal', 'Build pipeline', container.projectPath);

      const t1 = container.taskLifecycleService.createTask({
        title: 'Step 1: Setup Models',
        goalId: goal.id,
        acceptanceCriteria: 'Models written',
      });

      const t2 = container.taskLifecycleService.createTask({
        title: 'Step 2: Setup Controllers',
        goalId: goal.id,
        acceptanceCriteria: 'Controllers written',
        dependsOnTaskIds: [t1.task.id],
      });

      // Claim Task 1
      container.claimService.claimTask(t1.task.id, 'pipeline-agent', 'sess-100');

      // Complete Task 1 and atomically claim Task 2 (which becomes unblocked upon Task 1 completion)
      const completeAndClaimRes = await callTool({
        method: 'tools/call',
        params: {
          name: 'moo_complete_and_claim_next',
          arguments: {
            taskId: t1.task.id,
            agentId: 'pipeline-agent',
            sessionId: 'sess-100',
            evidence: {
              commandsRun: ['npm test models.test.ts'],
              testProof: 'All models verified',
            },
            nextDeclaredFiles: ['src/controllers/auth.ts'],
            nextLeaseSeconds: 600,
          },
        },
      });

      const data = JSON.parse(completeAndClaimRes.content[0].text);
      expect(data.success).toBe(true);
      expect(data.completedTask.id).toBe(t1.task.id);
      expect(data.completedTask.status).toBe('done');

      expect(data.nextTask).toBeDefined();
      expect(data.nextTask.id).toBe(t2.task.id);
      expect(data.nextTask.status).toBe('doing');
      expect(data.nextTask.claimedByAgent).toBe('pipeline-agent');
      expect(data.nextTask.declaredFiles).toContain('src/controllers/auth.ts');
    });

    it('lists and reads native MCP resources (compact context, active goals, ready queue, settled decisions)', async () => {
      const server = setupMcpServer(container);
      const listResourcesHandler = (server as any)._requestHandlers.get(ListResourcesRequestSchema.shape.method.value);
      const readResourceHandler = (server as any)._requestHandlers.get(ReadResourceRequestSchema.shape.method.value);

      // 1. List resources
      const listRes = await listResourcesHandler({ method: 'resources/list' });
      expect(listRes.resources).toBeDefined();
      expect(listRes.resources.length).toBe(4);

      const uris = listRes.resources.map((r: any) => r.uri);
      expect(uris).toContain('moo://context/compact');
      expect(uris).toContain('moo://goals/active');
      expect(uris).toContain('moo://tasks/ready');
      expect(uris).toContain('moo://decisions/settled');

      // 2. Setup sample data
      const goal = container.goalService.createGoal(
        'MCP Resource Test Goal',
        'Human requested resource testing',
        container.projectPath,
        5,
        '# PRD Specification\n- Detail A\n- Detail B'
      );
      container.taskLifecycleService.createTask({
        title: 'Ready Queue Task',
        goalId: goal.id,
        acceptanceCriteria: 'Ready test criteria',
      });
      container.decisionService.recordDecision({
        title: 'Use MCP Resources Protocol',
        context: 'AI coding tools support native context injection',
        choice: 'MCP Resources',
        rationale: 'Allows IDEs to pull fresh context automatically',
        projectPath: container.projectPath,
        authorId: 'architect-1',
      });

      // 3. Read moo://context/compact
      const compactRes = await readResourceHandler({
        method: 'resources/read',
        params: { uri: 'moo://context/compact' },
      });
      expect(compactRes.contents[0].text).toContain('# 🐮 MOO TASKS CONTEXT');
      expect(compactRes.contents[0].text).toContain('MCP Resource Test Goal');

      // 4. Read moo://goals/active
      const goalsRes = await readResourceHandler({
        method: 'resources/read',
        params: { uri: 'moo://goals/active' },
      });
      expect(goalsRes.contents[0].text).toContain('# 🎯 Active Project Goals');
      expect(goalsRes.contents[0].text).toContain('MCP Resource Test Goal');
      expect(goalsRes.contents[0].text).toContain('# PRD Specification');

      // 5. Read moo://tasks/ready
      const tasksRes = await readResourceHandler({
        method: 'resources/read',
        params: { uri: 'moo://tasks/ready' },
      });
      const parsedTasks = JSON.parse(tasksRes.contents[0].text);
      expect(parsedTasks.total).toBe(1);
      expect(parsedTasks.readyTasks[0].title).toBe('Ready Queue Task');

      // 6. Read moo://decisions/settled
      const decisionsRes = await readResourceHandler({
        method: 'resources/read',
        params: { uri: 'moo://decisions/settled' },
      });
      expect(decisionsRes.contents[0].text).toContain('Use MCP Resources Protocol');
      expect(decisionsRes.contents[0].text).toContain('Allows IDEs to pull fresh context automatically');
    });

    it('lists and gets native MCP prompts (moo_plan_feature and moo_execute_next)', async () => {
      const server = setupMcpServer(container);
      const listPromptsHandler = (server as any)._requestHandlers.get(ListPromptsRequestSchema.shape.method.value);
      const getPromptHandler = (server as any)._requestHandlers.get(GetPromptRequestSchema.shape.method.value);

      // 1. List prompts
      const listRes = await listPromptsHandler({ method: 'prompts/list' });
      expect(listRes.prompts).toBeDefined();
      expect(listRes.prompts.length).toBeGreaterThanOrEqual(2);

      const promptNames = listRes.prompts.map((p: any) => p.name);
      expect(promptNames).toContain('moo_plan_feature');
      expect(promptNames).toContain('moo_execute_next');

      // 2. Get moo_plan_feature prompt
      const planPromptRes = await getPromptHandler({
        method: 'prompts/get',
        params: {
          name: 'moo_plan_feature',
          arguments: {
            featureRequest: 'Build user notification system with Webhooks',
          },
        },
      });
      expect(planPromptRes.messages[0].content.text).toContain('Build user notification system with Webhooks');
      expect(planPromptRes.messages[0].content.text).toContain('moo_create_goal');

      // 3. Get moo_execute_next prompt
      const executePromptRes = await getPromptHandler({
        method: 'prompts/get',
        params: {
          name: 'moo_execute_next',
          arguments: {
            agentId: 'coder-bot',
          },
        },
      });
      expect(executePromptRes.messages[0].content.text).toContain("coder-bot");
      expect(executePromptRes.messages[0].content.text).toContain('moo_claim_task');
    });
  });
});
