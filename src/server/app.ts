import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ServiceContainer } from '../services/index.js';
import { DatabaseManager } from '../infrastructure/db/database.js';
import {
  DomainError,
  GoalNotFoundError,
  TaskNotFoundError,
  DecisionNotFoundError,
} from '../domain/errors.js';

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

  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof DomainError) {
      const isNotFound =
        error instanceof TaskNotFoundError ||
        error instanceof GoalNotFoundError ||
        error instanceof DecisionNotFoundError;
      return reply.status(isNotFound ? 404 : 400).send({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    return reply.status(error.statusCode || 500).send({
      success: false,
      error: error.message || 'Internal Server Error',
    });
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
        sseClients.delete(send);
      }
    }
  }

  // Native SQLite WAL File Watcher for Instant Cross-Process Multi-Agent Sync
  const watchers: fs.FSWatcher[] = [];
  let walDebounceTimer: NodeJS.Timeout | null = null;

  const dirsToWatch = [
    DatabaseManager.getGlobalMooDir(),
    path.join(container.projectPath, '.moo'),
  ];

  for (const dir of dirsToWatch) {
    if (fs.existsSync(dir)) {
      try {
        const w = fs.watch(dir, (eventType, filename) => {
          if (
            filename &&
            (filename.endsWith('.db') ||
              filename.endsWith('.db-wal') ||
              filename.endsWith('.db-shm') ||
              filename === 'tasks.db' ||
              filename === 'tasks.db-wal')
          ) {
            if (walDebounceTimer) clearTimeout(walDebounceTimer);
            walDebounceTimer = setTimeout(() => {
              broadcast('tasks_updated', {
                source: 'sqlite_wal_change',
                filename,
                timestamp: Date.now(),
              });
              broadcast('goals_updated', {
                source: 'sqlite_wal_change',
                filename,
                timestamp: Date.now(),
              });
            }, 75);
          }
        });
        watchers.push(w);
      } catch {
        // Ignore if filesystem watch not supported in environment
      }
    }
  }

  // High-Precision Cross-Process SQLite WAL Synchronization Engine (PRAGMA data_version)
  let lastDataVersion: number | null = null;
  try {
    lastDataVersion = container.db.pragma('data_version', { simple: true }) as number;
  } catch {}

  const dataVersionPollInterval = setInterval(() => {
    try {
      const currentVersion = container.db.pragma('data_version', { simple: true }) as number;
      if (lastDataVersion !== null && currentVersion !== lastDataVersion) {
        lastDataVersion = currentVersion;
        broadcast('tasks_updated', {
          source: 'sqlite_data_version_change',
          version: currentVersion,
          timestamp: Date.now(),
        });
        broadcast('goals_updated', {
          source: 'sqlite_data_version_change',
          version: currentVersion,
          timestamp: Date.now(),
        });
      } else {
        lastDataVersion = currentVersion;
      }
    } catch {
      // ignore
    }
  }, 250);

  // Periodic lease cleanup & background broadcast
  const leaseCleanupInterval = setInterval(() => {
    try {
      const released = container.claimService.cleanupExpiredLeases();
      if (released > 0) {
        broadcast('tasks_updated', { reason: 'expired_leases_cleaned', count: released });
      }
    } catch {
      // ignore
    }
  }, 10000);

  // SSE Keep-Alive Heartbeat Ping every 10s
  const heartbeatInterval = setInterval(() => {
    for (const send of sseClients) {
      try {
        send('ping', { timestamp: Date.now() });
      } catch {
        sseClients.delete(send);
      }
    }
  }, 10000);

  app.addHook('onClose', (instance, done) => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    clearInterval(dataVersionPollInterval);
    clearInterval(leaseCleanupInterval);
    clearInterval(heartbeatInterval);
    done();
  });

  // SSE Endpoint with Cross-Device & LAN Support
  app.get('/api/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform, no-store, must-revalidate');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Pragma', 'no-cache');
    reply.raw.setHeader('Expires', '0');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', '*');
    reply.raw.flushHeaders();

    // 2KB initial comment padding to bypass buffering on mobile browsers / routers
    reply.raw.write(`: ${' '.repeat(2048)}\n\n`);

    const sendEvent = (event: string, data: any) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        sseClients.delete(sendEvent);
        return;
      }
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        sseClients.delete(sendEvent);
      }
    };

    sseClients.add(sendEvent);
    sendEvent('connected', { timestamp: new Date().toISOString() });

    req.raw.on('close', () => {
      sseClients.delete(sendEvent);
    });

    req.raw.on('error', () => {
      sseClients.delete(sendEvent);
    });
  });

  // --- API Routes ---

  // Workspaces
  app.get('/api/workspaces', async (req, reply) => {
    const workspaces = container.workspaceService.listWorkspaces();
    const detailed = workspaces.map((ws) => {
      const goals = container.goalRepo.list(undefined, undefined, ws.id);
      const tasks = container.taskRepo.list({ workspaceId: ws.id });
      const openTasks = tasks.filter(
        (t) => ['todo', 'doing', 'blocked-on-dependency', 'waiting-on-human'].includes(t.status) && !t.isArchived
      );
      return {
        ...ws,
        totalGoals: goals.length,
        activeGoals: goals.filter((g) => g.status === 'active').length,
        totalTasks: tasks.length,
        openTasks: openTasks.length,
        isActive: ws.id === container.activeWorkspace.id,
      };
    });
    return { success: true, activeWorkspace: container.activeWorkspace, workspaces: detailed };
  });

  app.post('/api/workspaces', async (req, reply) => {
    const { projectPath, name } = req.body as any;
    if (!projectPath) {
      return reply.status(400).send({ success: false, error: 'projectPath is required' });
    }
    const ws = container.workspaceService.getOrCreateWorkspace(projectPath, name);
    broadcast('workspaces_updated', { workspace: ws });
    return { success: true, workspace: ws };
  });

  app.get('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as any;
    const ws = container.workspaceService.getWorkspace(id);
    if (!ws) {
      return reply.status(404).send({ success: false, error: 'Workspace not found' });
    }
    return { success: true, workspace: ws };
  });

  app.put('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as any;
    const { name, rootPath, gitRemote } = req.body as any;
    const ws = container.workspaceService.updateWorkspace(id, { name, rootPath, gitRemote });
    if (ws.id === container.activeWorkspace.id) {
      container.activeWorkspace = ws;
      container.projectPath = ws.rootPath;
    }
    broadcast('workspaces_updated', { workspace: ws });
    broadcast('project_updated', { workspace: ws });
    return { success: true, workspace: ws };
  });

  app.patch('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as any;
    const { name, rootPath, gitRemote } = req.body as any;
    const ws = container.workspaceService.updateWorkspace(id, { name, rootPath, gitRemote });
    if (ws.id === container.activeWorkspace.id) {
      container.activeWorkspace = ws;
      container.projectPath = ws.rootPath;
    }
    broadcast('workspaces_updated', { workspace: ws });
    broadcast('project_updated', { workspace: ws });
    return { success: true, workspace: ws };
  });

  app.delete('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as any;
    const deleted = container.workspaceService.deleteWorkspace(id);
    broadcast('workspaces_updated', { action: 'deleted', workspaceId: id });
    return { success: deleted };
  });

  app.post('/api/workspaces/switch', async (req, reply) => {
    const { workspaceId } = req.body as any;
    const ws = container.workspaceService.getWorkspace(workspaceId);
    if (!ws) {
      return reply.status(404).send({ success: false, error: 'Workspace not found' });
    }
    container.activeWorkspace = ws;
    container.projectPath = ws.rootPath;
    broadcast('workspaces_switched', { activeWorkspace: ws });
    broadcast('goals_updated', { activeWorkspace: ws });
    broadcast('tasks_updated', { activeWorkspace: ws });
    return { success: true, activeWorkspace: ws };
  });

  // Goals
  app.get('/api/goals', async (req, reply) => {
    const { status, workspaceId } = req.query as any;
    const targetWsId = workspaceId === 'all' ? undefined : (workspaceId || container.activeWorkspace.id);
    const goals = targetWsId
      ? container.goalService.listGoals(undefined, status, targetWsId)
      : container.goalService.listGoals(container.projectPath, status);
    const summaries = goals.map((g) => container.goalService.getGoalStatus(g.id));
    return { success: true, goals: summaries };
  });

  app.post('/api/goals', async (req, reply) => {
    const { title, verbatimPrompt, maxOpenTasksCap, description, workspaceId } = req.body as any;
    const goal = container.goalService.createGoal(
      title,
      verbatimPrompt,
      container.projectPath,
      maxOpenTasksCap,
      description,
      workspaceId || container.activeWorkspace.id
    );
    broadcast('goals_updated', { goal });
    return { success: true, goal };
  });

  app.get('/api/goals/:id', async (req, reply) => {
    const { id } = req.params as any;
    const goal = container.goalService.getGoal(id);
    const summary = container.goalService.getGoalStatus(id);
    const tasks = container.taskRepo.listByGoalId(id).filter((t) => !t.isArchived);
    return { success: true, goal, summary, tasks };
  });

  app.put('/api/goals/:id', async (req, reply) => {
    const { id } = req.params as any;
    const { title, description, verbatimPrompt, maxOpenTasksCap, status } = req.body as any;
    const goal = container.goalService.updateGoal(id, {
      title,
      description,
      verbatimPrompt,
      maxOpenTasksCap,
      status,
    });
    broadcast('goals_updated', { goal, action: 'updated' });
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

  app.delete('/api/goals/:id', async (req, reply) => {
    const { id } = req.params as any;
    const deleted = container.goalRepo.delete(id);
    broadcast('goals_updated', { goalId: id, action: 'deleted' });
    broadcast('tasks_updated', { goalId: id });
    return { success: deleted };
  });

  // Search (FTS5)
  app.get('/api/search', async (req, reply) => {
    const { q, type, limit } = req.query as any;
    const results = container.searchService.search(q || '', {
      type: type || 'all',
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return { success: true, ...results };
  });

  // Diagnostics & Stall Detection
  app.get('/api/diagnostics/stalls', async (req, reply) => {
    const warnings = container.sessionService.detectAgentStallsAndThrashing(container.projectPath);
    return { success: true, count: warnings.length, warnings };
  });

  // Tasks
  app.get('/api/tasks', async (req, reply) => {
    const query = req.query as any;
    const filter = { ...query };
    if (!filter.workspaceId && filter.workspaceId !== 'all') {
      filter.workspaceId = container.activeWorkspace.id;
    } else if (filter.workspaceId === 'all') {
      delete filter.workspaceId;
    }
    const tasks = container.taskRepo.list(filter);
    return { success: true, total: tasks.length, tasks };
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = req.body as any;
    if (!body.workspaceId) {
      body.workspaceId = container.activeWorkspace.id;
    }
    const res = container.taskLifecycleService.createTask(body, 'human', 'human');
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

  app.delete('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as any;
    const deleted = container.taskRepo.delete(id);
    broadcast('tasks_updated', { action: 'deleted', taskId: id });
    return { success: deleted };
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
    container.taskLifecycleService.addDependency(id, dependsOnTaskId);
    broadcast('tasks_updated', { action: 'dependency_added', taskId: id, dependsOnTaskId });
    return { success: true };
  });

  app.delete('/api/tasks/:id/dependencies/:dependsOnTaskId', async (req, reply) => {
    const { id, dependsOnTaskId } = req.params as any;
    container.taskLifecycleService.removeDependency(id, dependsOnTaskId);
    broadcast('tasks_updated', { action: 'dependency_removed', taskId: id, dependsOnTaskId });
    return { success: true };
  });

  app.post('/api/tasks/bulk/update', async (req, reply) => {
    const { taskIds, updates } = req.body as any;
    if (!Array.isArray(taskIds) || !updates) {
      return reply.status(400).send({ success: false, error: 'taskIds array and updates object required' });
    }
    for (const id of taskIds) {
      if (updates.status) {
        container.taskLifecycleService.transitionStatus(id, updates.status, updates.authorId || 'human-batch', 'human', updates.reason);
      }
      const taskUpdates: any = {};
      if (updates.priority) taskUpdates.priority = updates.priority;
      if (updates.type) taskUpdates.type = updates.type;
      if (updates.tags) taskUpdates.tags = updates.tags;
      if (Object.keys(taskUpdates).length > 0) {
        container.taskLifecycleService.updateTask(id, taskUpdates);
      }
    }
    broadcast('tasks_updated', { action: 'bulk_updated', count: taskIds.length });
    return { success: true, updatedCount: taskIds.length };
  });

  app.post('/api/import/markdown', async (req, reply) => {
    const { content, goalId, goalTitle, sequentialPhases } = req.body as any;
    if (!content || typeof content !== 'string') {
      return reply.status(400).send({ success: false, error: 'Markdown content string is required' });
    }
    const result = container.markdownImportService.importMarkdown(content, {
      goalId,
      goalTitle,
      projectPath: container.projectPath,
      sequentialPhases: sequentialPhases !== false,
      authorId: 'human-web',
      authorType: 'human',
    });
    broadcast('goals_updated', { action: 'imported', goalId: result.goal?.id });
    broadcast('tasks_updated', { action: 'imported', count: result.importedCount });
    return { success: true, ...result };
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
    const { status, tag, workspaceId } = req.query as any;
    const targetWsId = workspaceId === 'all' ? undefined : (workspaceId || container.activeWorkspace.id);
    const decisions = targetWsId
      ? container.decisionService.listDecisions(undefined, status, tag, targetWsId)
      : container.decisionService.listDecisions(container.projectPath, status, tag);
    return { success: true, decisions };
  });

  app.post('/api/decisions', async (req, reply) => {
    const { title, context, choice, rationale, tags, workspaceId } = req.body as any;
    const dec = container.decisionService.recordDecision({
      title,
      context,
      choice,
      rationale,
      tags,
      workspaceId: workspaceId || container.activeWorkspace.id,
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
        workspaceId: container.activeWorkspace.id,
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
      projectName: container.activeWorkspace.name || path.basename(container.projectPath),
      projectPath: container.projectPath,
      workspace: container.activeWorkspace,
    };
  });

  // File Context
  app.post('/api/context/files', async (req, reply) => {
    const { filePaths, files } = req.body as any;
    const raw = filePaths || files || [];
    const list = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const summary = container.sessionService.getFileContext(list, container.projectPath);
    return { success: true, ...summary };
  });

  app.get('/api/context/files', async (req, reply) => {
    const { paths } = req.query as any;
    const list = paths ? paths.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
    const summary = container.sessionService.getFileContext(list, container.projectPath);
    return { success: true, ...summary };
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
