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
    it('lists all registered MCP tools', async () => {
      const server = setupMcpServer(container);
      const listHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
      const res = await listHandler({ method: 'tools/list' });
      expect(res.tools).toBeDefined();
      expect(res.tools.length).toBeGreaterThanOrEqual(18);

      const toolNames = res.tools.map((t: any) => t.name);
      expect(toolNames).toContain('moo_create_goal');
      expect(toolNames).toContain('moo_create_task');
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
