import { describe, it, expect, beforeEach } from 'vitest';
import { createServiceContainer, ServiceContainer } from '../services/index.js';
import { setupMcpServer } from '../mcp/server.js';
import { buildServer } from '../server/app.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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
});
