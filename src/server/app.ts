import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ServiceContainer } from '../services/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  port?: number;
  host?: string;
}

export function buildServer(container: ServiceContainer): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.register(cors, {
    origin: '*',
  });

  // SSE client connections registry
  const sseClients = new Set<(event: string, data: any) => void>();

  function broadcast(event: string, data: any) {
    for (const send of sseClients) {
      try {
        send(event, data);
      } catch {
        // ignore dead clients
      }
    }
  }

  // Periodic lease cleanup & background broadcast
  setInterval(() => {
    try {
      const released = container.claimService.cleanupExpiredLeases();
      if (released > 0) {
        broadcast('tasks_updated', { reason: 'expired_leases_cleaned', count: released });
      }
    } catch {
      // ignore
    }
  }, 15000);

  // SSE Endpoint
  app.get('/api/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sseClients.add(sendEvent);
    sendEvent('connected', { timestamp: new Date().toISOString() });

    req.raw.on('close', () => {
      sseClients.delete(sendEvent);
    });
  });

  // --- API Routes ---

  // Goals
  app.get('/api/goals', async (req, reply) => {
    const { status } = req.query as any;
    const goals = container.goalService.listGoals(container.projectPath, status);
    const summaries = goals.map((g) => container.goalService.getGoalStatus(g.id));
    return { success: true, goals: summaries };
  });

  app.post('/api/goals', async (req, reply) => {
    const { title, verbatimPrompt, maxOpenTasksCap } = req.body as any;
    const goal = container.goalService.createGoal(
      title,
      verbatimPrompt,
      container.projectPath,
      maxOpenTasksCap
    );
    broadcast('goals_updated', { goal });
    return { success: true, goal };
  });

  app.get('/api/goals/:id/status', async (req, reply) => {
    const { id } = req.params as any;
    const summary = container.goalService.getGoalStatus(id);
    return { success: true, summary };
  });

  app.post('/api/goals/:id/kill', async (req, reply) => {
    const { id } = req.params as any;
    const { reason, authorId } = req.body as any;
    const result = container.goalService.killGoal(id, reason, authorId || 'human');
    broadcast('goals_updated', { goalId: id, action: 'killed' });
    broadcast('tasks_updated', { goalId: id });
    return { success: true, ...result };
  });

  app.post('/api/goals/:id/reopen', async (req, reply) => {
    const { id } = req.params as any;
    const goal = container.goalService.reopenGoal(id, 'human');
    broadcast('goals_updated', { goalId: id, action: 'reopened' });
    broadcast('tasks_updated', { goalId: id });
    return { success: true, goal };
  });

  // Tasks
  app.get('/api/tasks', async (req, reply) => {
    const tasks = container.taskRepo.list(req.query as any);
    return { success: true, total: tasks.length, tasks };
  });

  app.post('/api/tasks', async (req, reply) => {
    const res = container.taskLifecycleService.createTask(req.body as any, 'human', 'human');
    broadcast('tasks_updated', { task: res.task, action: 'created' });
    return { success: true, ...res };
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as any;
    const task = container.taskLifecycleService.getTask(id);
    const subtasks = container.taskRepo.listSubtasks(id);
    const dependencies = container.taskRepo.getDependencies(id);
    const dependents = container.taskRepo.getDependents(id);
    const notes = container.noteRepo.listByTaskId(id);
    const history = container.statusHistoryRepo.listByTaskId(id);
    return { success: true, task, subtasks, dependencies, dependents, notes, history };
  });

  app.put('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as any;
    const updated = container.taskLifecycleService.updateTask(id, req.body as any);
    broadcast('tasks_updated', { task: updated, action: 'updated' });
    return { success: true, task: updated };
  });

  app.post('/api/tasks/:id/status', async (req, reply) => {
    const { id } = req.params as any;
    const { status, reason, authorId } = req.body as any;
    const updated = container.taskLifecycleService.transitionStatus(
      id,
      status,
      authorId || 'human',
      'human',
      reason
    );
    broadcast('tasks_updated', { task: updated, action: 'status_changed' });
    return { success: true, task: updated };
  });

  app.post('/api/tasks/:id/drop', async (req, reply) => {
    const { id } = req.params as any;
    const { reason, authorId } = req.body as any;
    const task = container.taskLifecycleService.dropTask(id, reason, authorId || 'human', 'human');
    broadcast('tasks_updated', { task, action: 'dropped' });
    return { success: true, task };
  });

  app.post('/api/tasks/:id/reopen', async (req, reply) => {
    const { id } = req.params as any;
    const { reason, authorId } = req.body as any;
    const task = container.taskLifecycleService.reopenTask(id, reason, authorId || 'human', 'human');
    broadcast('tasks_updated', { task, action: 'reopened' });
    return { success: true, task };
  });

  app.post('/api/tasks/:id/undo', async (req, reply) => {
    const { id } = req.params as any;
    const task = container.taskLifecycleService.undoStatusChange(id, 'human', 'human');
    broadcast('tasks_updated', { task, action: 'undo' });
    return { success: true, task };
  });

  app.post('/api/tasks/:id/merge', async (req, reply) => {
    const { id } = req.params as any;
    const { targetTaskId, reason } = req.body as any;
    const result = container.duplicateMergeService.mergeTasks(targetTaskId, id, 'human', reason);
    broadcast('tasks_updated', { action: 'merged', targetTaskId, sourceTaskId: id });
    return { success: true, ...result };
  });

  app.post('/api/tasks/:id/dependencies', async (req, reply) => {
    const { id } = req.params as any;
    const { dependsOnTaskId } = req.body as any;
    container.taskRepo.addDependency(id, dependsOnTaskId);
    broadcast('tasks_updated', { action: 'dependency_added', taskId: id, dependsOnTaskId });
    return { success: true };
  });

  app.delete('/api/tasks/:id/dependencies/:dependsOnTaskId', async (req, reply) => {
    const { id, dependsOnTaskId } = req.params as any;
    container.taskRepo.removeDependency(id, dependsOnTaskId);
    broadcast('tasks_updated', { action: 'dependency_removed', taskId: id, dependsOnTaskId });
    return { success: true };
  });

  app.post('/api/tasks/bulk/drop', async (req, reply) => {
    const { taskIds, reason } = req.body as any;
    const count = container.taskLifecycleService.bulkDrop(taskIds, reason, 'human', 'human');
    broadcast('tasks_updated', { action: 'bulk_dropped', count });
    return { success: true, droppedCount: count };
  });

  app.post('/api/tasks/bulk/reopen', async (req, reply) => {
    const { taskIds, reason } = req.body as any;
    const count = container.taskLifecycleService.bulkReopen(taskIds, reason, 'human', 'human');
    broadcast('tasks_updated', { action: 'bulk_reopened', count });
    return { success: true, reopenedCount: count };
  });

  app.post('/api/tasks/reorder', async (req, reply) => {
    const { updates } = req.body as any;
    container.taskLifecycleService.reorderTasks(updates);
    broadcast('tasks_updated', { action: 'reordered' });
    return { success: true };
  });

  // Verification & Human Collab
  app.post('/api/tasks/:id/verify', async (req, reply) => {
    const { id } = req.params as any;
    const { notes } = req.body as any;
    const task = container.verificationService.verifyTask(id, 'human-reviewer', 'human', notes);
    broadcast('tasks_updated', { task, action: 'verified' });
    return { success: true, task };
  });

  app.post('/api/tasks/:id/reject', async (req, reply) => {
    const { id } = req.params as any;
    const { reason } = req.body as any;
    const task = container.verificationService.rejectTask(id, 'human-reviewer', 'human', reason);
    broadcast('tasks_updated', { task, action: 'rejected' });
    return { success: true, task };
  });

  app.get('/api/human/inbox', async (req, reply) => {
    const inbox = container.humanCollabService.getHumanInbox();
    return { success: true, total: inbox.length, inbox };
  });

  app.post('/api/tasks/:id/answer', async (req, reply) => {
    const { id } = req.params as any;
    const { answer, humanId } = req.body as any;
    const task = container.humanCollabService.answerHuman(id, humanId || 'human', answer);
    broadcast('tasks_updated', { task, action: 'answered' });
    return { success: true, task };
  });

  // Decisions
  app.get('/api/decisions', async (req, reply) => {
    const { status, tag } = req.query as any;
    const decisions = container.decisionService.listDecisions(container.projectPath, status, tag);
    return { success: true, decisions };
  });

  app.post('/api/decisions', async (req, reply) => {
    const { title, context, choice, rationale, tags } = req.body as any;
    const dec = container.decisionService.recordDecision({
      title,
      context,
      choice,
      rationale,
      tags,
      projectPath: container.projectPath,
      authorId: 'human',
      authorType: 'human',
    });
    broadcast('decisions_updated', { decision: dec });
    return { success: true, decision: dec };
  });

  app.post('/api/decisions/:id/supersede', async (req, reply) => {
    const { id } = req.params as any;
    const { title, context, choice, rationale, tags, reason } = req.body as any;
    const result = container.decisionService.supersedeDecision(
      id,
      {
        title,
        context,
        choice,
        rationale,
        tags,
        projectPath: container.projectPath,
        authorId: 'human',
        authorType: 'human',
      },
      reason
    );
    broadcast('decisions_updated', { action: 'superseded', oldId: id, newId: result.newDecision.id });
    return { success: true, ...result };
  });

  // Activity Feed & Notes
  app.get('/api/activity', async (req, reply) => {
    const notes = container.noteRepo.listRecent(50);
    return { success: true, notes };
  });

  app.post('/api/tasks/:id/notes', async (req, reply) => {
    const { id } = req.params as any;
    const { content, noteType } = req.body as any;
    const note = container.noteRepo.create({
      id: `note-${Math.random().toString(36).slice(2, 9)}`,
      taskId: id,
      authorType: 'human',
      authorId: 'human',
      noteType: noteType || 'general',
      content,
      createdAt: new Date().toISOString(),
    });
    broadcast('activity_updated', { note });
    return { success: true, note };
  });

  // Project Info
  app.get('/api/project', async (req, reply) => {
    return {
      success: true,
      projectName: path.basename(container.projectPath),
      projectPath: container.projectPath,
    };
  });

  // Resume & Export
  app.get('/api/resume', async (req, reply) => {
    const summary = container.sessionService.whereDidILeaveOff(container.projectPath);
    return { success: true, summary };
  });

  app.get('/api/export', async (req, reply) => {
    const { format } = req.query as any;
    const data = container.housekeepingService.exportProject(container.projectPath, format || 'markdown');
    return { success: true, content: data };
  });

  // Serve static UI assets from dist/ui or src/ui
  let uiPath = path.join(__dirname, '../ui');
  if (!fs.existsSync(uiPath)) {
    uiPath = path.join(process.cwd(), 'src/ui');
  }

  if (fs.existsSync(uiPath)) {
    app.register(fastifyStatic, {
      root: uiPath,
      prefix: '/',
    });
  }

  return app;
}
