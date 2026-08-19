import { describe, it, expect, beforeEach } from 'vitest';
import { createServiceContainer, ServiceContainer } from '../services/index.js';
import {
  GoalCapExceededError,
  MissingEvidenceError,
  ParentHasOpenSubtasksError,
  SubtaskNestingError,
  TaskAlreadyClaimedError,
  TaskBlockedOnDependencyError,
  TaskNotFoundError,
  TaskWaitingOnHumanError,
} from '../domain/errors.js';
import { DatabaseManager } from '../infrastructure/db/database.js';

describe('Moo Tasks Core Domain & Services', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = createServiceContainer({ inMemory: true, projectPath: '/test/project' });
  });

  describe('Goals & Task Caps', () => {
    it('creates goal and attaches verbatim prompt', () => {
      const goal = container.goalService.createGoal(
        'Implement Auth System',
        'Human verbatim: Please implement JWT and OAuth login.',
        '/test/project',
        2 // Max 2 open tasks
      );

      expect(goal.id).toMatch(/^goal-/);
      expect(goal.title).toBe('Implement Auth System');
      expect(goal.maxOpenTasksCap).toBe(2);

      const status = container.goalService.getGoalStatus(goal.id);
      expect(status.totalTasks).toBe(0);
      expect(status.isFullyCovered).toBe(false);
    });

    it('creates and updates goal rich markdown description PRD spec', () => {
      const goal = container.goalService.createGoal(
        'Design Architecture',
        'User prompt',
        '/test/project',
        5,
        '# Architectural Spec\n\n- Component A\n- Component B'
      );

      expect(goal.description).toBe('# Architectural Spec\n\n- Component A\n- Component B');

      const updated = container.goalService.updateGoal(goal.id, {
        title: 'Updated Architecture Design',
        description: '# Updated PRD\n\nFull specification breakdown.',
        maxOpenTasksCap: 8,
      });

      expect(updated.title).toBe('Updated Architecture Design');
      expect(updated.description).toBe('# Updated PRD\n\nFull specification breakdown.');
      expect(updated.maxOpenTasksCap).toBe(8);

      const fetched = container.goalService.getGoal(goal.id);
      expect(fetched.description).toBe('# Updated PRD\n\nFull specification breakdown.');
    });

    it('enforces open task cap on goal to prevent over-planning', () => {
      const goal = container.goalService.createGoal(
        'Refactor Database',
        'Make DB faster',
        '/test/project',
        2
      );

      // Create 2 tasks
      container.taskLifecycleService.createTask({
        title: 'Task 1',
        goalId: goal.id,
        acceptanceCriteria: 'Task 1 done',
      });

      container.taskLifecycleService.createTask({
        title: 'Task 2',
        goalId: goal.id,
        acceptanceCriteria: 'Task 2 done',
      });

      // 3rd task should throw GoalCapExceededError
      expect(() => {
        container.taskLifecycleService.createTask({
          title: 'Task 3',
          goalId: goal.id,
          acceptanceCriteria: 'Task 3 done',
        });
      }).toThrow(GoalCapExceededError);
    });

    it('cascades drop when killing a goal', () => {
      const goal = container.goalService.createGoal('Temporary Goal', 'Human request', '/test/project');
      const t1 = container.taskLifecycleService.createTask({
        title: 'Subtask 1',
        goalId: goal.id,
        acceptanceCriteria: 'AC 1',
      });

      const killResult = container.goalService.killGoal(goal.id, 'User cancelled requirement', 'human-1');
      expect(killResult.droppedTaskCount).toBe(1);

      const fetchedTask = container.taskLifecycleService.getTask(t1.task.id);
      expect(fetchedTask.status).toBe('dropped');
      expect(fetchedTask.droppedReason).toContain('Goal dropped: User cancelled requirement');
    });
  });

  describe('Task Lifecycle & Subtasks', () => {
    it('restricts subtasks to exactly 1 level of depth', () => {
      const parent = container.taskLifecycleService.createTask({
        title: 'Parent Task',
        acceptanceCriteria: 'Parent AC',
      });

      const subtask = container.taskLifecycleService.createTask({
        title: 'Subtask 1',
        parentId: parent.task.id,
        acceptanceCriteria: 'Sub AC',
      });

      expect(subtask.task.parentId).toBe(parent.task.id);

      // Attempting to create a child under subtask must fail
      expect(() => {
        container.taskLifecycleService.createTask({
          title: 'Invalid Nested Subtask',
          parentId: subtask.task.id,
          acceptanceCriteria: 'Nested AC',
        });
      }).toThrow(SubtaskNestingError);
    });

    it('prevents closing parent task when subtasks remain open', () => {
      const parent = container.taskLifecycleService.createTask({
        title: 'Parent with child',
        acceptanceCriteria: 'Parent done',
      });

      container.taskLifecycleService.createTask({
        title: 'Open child task',
        parentId: parent.task.id,
        acceptanceCriteria: 'Child done',
      });

      expect(() => {
        container.verificationService.completeTask(
          parent.task.id,
          'agent-1',
          { commandsRun: ['npm test'], outputSnippet: 'Passed' }
        );
      }).toThrow(ParentHasOpenSubtasksError);
    });

    it('auto-resolves dependencies when blocker task finishes', () => {
      const blocker = container.taskLifecycleService.createTask({
        title: 'Blocker Setup DB',
        acceptanceCriteria: 'DB initialized',
      });

      const blocked = container.taskLifecycleService.createTask({
        title: 'Blocked Query API',
        acceptanceCriteria: 'API works',
        dependsOnTaskIds: [blocker.task.id],
      });

      expect(blocked.task.status).toBe('blocked-on-dependency');

      // Complete blocker with evidence
      container.verificationService.completeTask(
        blocker.task.id,
        'agent-1',
        { commandsRun: ['npx prisma db push'], outputSnippet: 'Done' }
      );

      // Downstream task should be auto-unblocked to 'todo'
      const updatedBlocked = container.taskLifecycleService.getTask(blocked.task.id);
      expect(updatedBlocked.status).toBe('todo');
    });

    it('surfaces next unblocked task in ready queue by priority', () => {
      container.taskLifecycleService.createTask({
        title: 'Low priority task',
        priority: 'low',
        acceptanceCriteria: 'low ac',
      });

      const highPriority = container.taskLifecycleService.createTask({
        title: 'Critical bug fix',
        priority: 'critical',
        acceptanceCriteria: 'critical ac',
      });

      const next = container.taskLifecycleService.getNextUnblockedTask();
      expect(next?.id).toBe(highPriority.task.id);
    });
  });

  describe('Claims, Concurrency & Leases', () => {
    it('claims task exclusively and prevents duplicate claim before lease expires', () => {
      const t = container.taskLifecycleService.createTask({
        title: 'Work on backend',
        acceptanceCriteria: 'backend ac',
      });

      const claimResult = container.claimService.claimTask(t.task.id, 'agent-A', 'sess-1', {
        leaseDurationSeconds: 60,
      });

      expect(claimResult.task.claimedByAgent).toBe('agent-A');
      expect(claimResult.task.status).toBe('doing');

      // Agent B attempts claim
      expect(() => {
        container.claimService.claimTask(t.task.id, 'agent-B', 'sess-2');
      }).toThrow(TaskAlreadyClaimedError);
    });

    it('detects file touch conflicts between parallel agents', () => {
      const t1 = container.taskLifecycleService.createTask({
        title: 'Edit Auth Controller',
        acceptanceCriteria: 'Auth ac',
        declaredFiles: ['src/auth/login.ts'],
      });

      const t2 = container.taskLifecycleService.createTask({
        title: 'Refactor Auth Routes',
        acceptanceCriteria: 'Routes ac',
        declaredFiles: ['src/auth/login.ts', 'src/routes.ts'],
      });

      container.claimService.claimTask(t1.task.id, 'agent-A', 'sess-1', {
        declaredFiles: ['src/auth/login.ts'],
      });

      const claim2 = container.claimService.claimTask(t2.task.id, 'agent-B', 'sess-2', {
        declaredFiles: ['src/auth/login.ts', 'src/routes.ts'],
      });

      expect(claim2.conflictWarnings.length).toBeGreaterThan(0);
      expect(claim2.conflictWarnings[0].conflictingTaskId).toBe(t1.task.id);
    });

    it('auto-injects matching settled ADRs upon task claim', () => {
      container.decisionService.recordDecision({
        title: 'Use SQLite WAL Mode',
        context: 'Need high concurrency and fast writes',
        choice: 'Enable WAL mode and busy timeout',
        rationale: 'WAL permits concurrent reads during write transactions',
        tags: ['sqlite', 'database', 'storage'],
        projectPath: '/test/project',
        authorId: 'architect-1',
      });

      const t = container.taskLifecycleService.createTask({
        title: 'Optimize SQLite database queries',
        acceptanceCriteria: 'Queries under 10ms',
        declaredFiles: ['src/db/sqlite-storage.ts'],
      });

      const claimRes = container.claimService.claimTask(t.task.id, 'agent-A', 'sess-1', {
        declaredFiles: ['src/db/sqlite-storage.ts'],
      });

      expect(claimRes.relatedDecisions).toBeDefined();
      expect(claimRes.relatedDecisions?.length).toBeGreaterThan(0);
      expect(claimRes.relatedDecisions?.[0].title).toBe('Use SQLite WAL Mode');
    });

    it('logs structured attempt failure and auto-escalates to human after exceeding max attempts', () => {
      const t = container.taskLifecycleService.createTask({
        title: 'Tricky race condition bug',
        acceptanceCriteria: 'No deadlocks',
      });

      // Attempt 1 failure
      const fail1 = container.taskLifecycleService.logAttemptFailure({
        taskId: t.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Deadlock on transaction lock acquire',
        failureCategory: 'concurrency',
        hypothesis: 'Table lock held too long in loop',
        nextAttemptPlan: 'Use row-level lock or shorter transaction',
      });

      expect(fail1.attemptCount).toBe(1);
      expect(fail1.autoEscalatedToHuman).toBe(false);
      expect(fail1.task.status).toBe('todo');
      expect(fail1.note.noteType).toBe('attempt_failure');
      expect(fail1.note.content).toContain('Deadlock on transaction lock acquire');

      // Attempt 2 failure
      container.taskLifecycleService.logAttemptFailure({
        taskId: t.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Timeout error',
      });

      // Attempt 3 failure
      container.taskLifecycleService.logAttemptFailure({
        taskId: t.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Lock wait timeout',
      });

      // Attempt 4 failure (exceeds default maxAttemptsAllowed = 3)
      const fail4 = container.taskLifecycleService.logAttemptFailure({
        taskId: t.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Still deadlocking',
      });

      expect(fail4.attemptCount).toBe(4);
      expect(fail4.autoEscalatedToHuman).toBe(true);
      expect(fail4.task.status).toBe('waiting-on-human');
      expect(fail4.task.humanQuestion).toContain('max allowed attempts');
    });
  });

  describe('Verification, Evidence & Human Collaboration', () => {
    it('requires evidence to complete a task', () => {
      const t = container.taskLifecycleService.createTask({
        title: 'Build Feature',
        acceptanceCriteria: 'Feature ac',
      });

      // Missing evidence throws
      expect(() => {
        container.verificationService.completeTask(t.task.id, 'agent-1', {});
      }).toThrow(MissingEvidenceError);

      // Valid evidence succeeds
      const completed = container.verificationService.completeTask(t.task.id, 'agent-1', {
        commandsRun: ['npm test -- auth.test.ts'],
        outputSnippet: '5 tests passed',
        testProof: 'Coverage 98%',
      });

      expect(completed.status).toBe('done');
      expect(completed.verificationState).toBe('agent_completed');
      expect(completed.closeCount).toBe(1);
    });

    it('supports human question asking and answering flow', () => {
      const t = container.taskLifecycleService.createTask({
        title: 'Configure S3 Bucket',
        acceptanceCriteria: 'Bucket created',
      });

      const paused = container.humanCollabService.askHuman(
        t.task.id,
        'agent-1',
        'Which AWS region should be targeted: us-east-1 or eu-west-1?',
        'clarification'
      );

      expect(paused.status).toBe('waiting-on-human');
      expect(paused.humanQuestion).toContain('Which AWS region');

      const inbox = container.humanCollabService.getHumanInbox();
      expect(inbox.some((item) => item.id === t.task.id)).toBe(true);

      const answered = container.humanCollabService.answerHuman(
        t.task.id,
        'lead-developer',
        'Target eu-west-1'
      );

      expect(answered.status).toBe('todo');
      expect(answered.humanAnswer).toBe('Target eu-west-1');
    });

    it('rejects a completed task and increments reopen count', () => {
      const t = container.taskLifecycleService.createTask({
        title: 'Fix UI Alignment',
        acceptanceCriteria: 'Buttons aligned',
      });

      container.verificationService.completeTask(t.task.id, 'agent-1', {
        outputSnippet: 'Rendered properly',
      });

      const rejected = container.verificationService.rejectTask(
        t.task.id,
        'human-reviewer',
        'human',
        'Button is still 2px off on mobile view'
      );

      expect(rejected.status).toBe('todo');
      expect(rejected.verificationState).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Button is still 2px off on mobile view');
      expect(rejected.reopenCount).toBe(1);
    });
  });

  describe('DAG Re-blocking on Reopen & Reject', () => {
    it('re-blocks downstream dependents when a completed task is rejected', () => {
      const blocker = container.taskLifecycleService.createTask({
        title: 'Blocker Setup API',
        acceptanceCriteria: 'API ready',
      });

      const dependent = container.taskLifecycleService.createTask({
        title: 'Dependent Consumer',
        acceptanceCriteria: 'Consumer working',
        dependsOnTaskIds: [blocker.task.id],
      });

      expect(dependent.task.status).toBe('blocked-on-dependency');

      // Complete blocker
      container.verificationService.completeTask(blocker.task.id, 'agent-1', {
        outputSnippet: 'API online',
      });

      // Dependent is unblocked
      expect(container.taskLifecycleService.getTask(dependent.task.id).status).toBe('todo');

      // Human rejects blocker
      container.verificationService.rejectTask(blocker.task.id, 'human-reviewer', 'human', 'API returns 500 error');

      // Blocker is back to todo, and dependent is re-blocked to blocked-on-dependency
      expect(container.taskLifecycleService.getTask(blocker.task.id).status).toBe('todo');
      expect(container.taskLifecycleService.getTask(dependent.task.id).status).toBe('blocked-on-dependency');
    });

    it('re-blocks downstream dependents when a completed task is reopened', () => {
      const blocker = container.taskLifecycleService.createTask({
        title: 'Blocker DB Setup',
        acceptanceCriteria: 'DB ready',
      });

      const dependent = container.taskLifecycleService.createTask({
        title: 'Dependent Query',
        acceptanceCriteria: 'Queries pass',
        dependsOnTaskIds: [blocker.task.id],
      });

      container.verificationService.completeTask(blocker.task.id, 'agent-1', {
        outputSnippet: 'DB migrated',
      });
      expect(container.taskLifecycleService.getTask(dependent.task.id).status).toBe('todo');

      // Reopen blocker
      container.taskLifecycleService.reopenTask(blocker.task.id, 'Need to add indexing', 'human-1');
      expect(container.taskLifecycleService.getTask(blocker.task.id).status).toBe('todo');
      expect(container.taskLifecycleService.getTask(dependent.task.id).status).toBe('blocked-on-dependency');
    });

    it('preserves 1-level subtask limit when merging into a subtask', () => {
      const parent = container.taskLifecycleService.createTask({
        title: 'Top Parent',
        acceptanceCriteria: 'Parent AC',
      });

      const targetSubtask = container.taskLifecycleService.createTask({
        title: 'Target Subtask',
        parentId: parent.task.id,
        acceptanceCriteria: 'Target AC',
      });

      const sourceTask = container.taskLifecycleService.createTask({
        title: 'Source Task',
        acceptanceCriteria: 'Source AC',
      });

      const sourceSubtask = container.taskLifecycleService.createTask({
        title: 'Source Subtask',
        parentId: sourceTask.task.id,
        acceptanceCriteria: 'Source sub AC',
      });

      // Merge sourceTask into targetSubtask (which is already a subtask of parent)
      container.duplicateMergeService.mergeTasks(targetSubtask.task.id, sourceTask.task.id, 'agent-1');

      // sourceSubtask should now have parentId = parent.task.id (not targetSubtask.id), preventing 2-level nesting
      const updatedSourceSubtask = container.taskLifecycleService.getTask(sourceSubtask.task.id);
      expect(updatedSourceSubtask.parentId).toBe(parent.task.id);
    });

    it('ignores expired leases when validating agent concurrency limits', () => {
      const t1 = container.taskLifecycleService.createTask({
        title: 'Task 1',
        acceptanceCriteria: 'AC 1',
      });
      const t2 = container.taskLifecycleService.createTask({
        title: 'Task 2',
        acceptanceCriteria: 'AC 2',
      });

      // Claim task 1 with negative lease duration (already expired)
      container.claimService.claimTask(t1.task.id, 'agent-concurrent', 'sess-1', {
        leaseDurationSeconds: -10, // Expired immediately
        maxConcurrentTasksPerAgent: 1,
      });

      // Claim task 2 should succeed without concurrency error because t1's lease is expired
      const claim2 = container.claimService.claimTask(t2.task.id, 'agent-concurrent', 'sess-2', {
        maxConcurrentTasksPerAgent: 1,
      });

      expect(claim2.task.id).toBe(t2.task.id);
      expect(claim2.task.claimedByAgent).toBe('agent-concurrent');
    });
  });

  describe('Architectural Decisions & Continuity', () => {
    it('records decisions and supports superseding', () => {
      const d1 = container.decisionService.recordDecision({
        title: 'Use SQLite for persistence',
        context: 'Need lightweight local embedded DB',
        choice: 'better-sqlite3',
        rationale: 'Fast synchronous API and zero dependencies',
        projectPath: '/test/project',
        authorId: 'agent-1',
        tags: ['db', 'storage'],
      });

      expect(d1.id).toMatch(/^dec-/);
      expect(d1.status).toBe('accepted');

      const { oldDecision, newDecision } = container.decisionService.supersedeDecision(
        d1.id,
        {
          title: 'Upgrade SQLite to LibSQL',
          context: 'Need edge sync capability',
          choice: 'LibSQL',
          rationale: 'Supports remote embedded sync',
          projectPath: '/test/project',
          authorId: 'architect-1',
          tags: ['db', 'storage'],
        },
        'Need remote distributed sync'
      );

      expect(oldDecision.status).toBe('superseded');
      expect(oldDecision.supersededById).toBe(newDecision.id);
    });

    it('generates Where-Did-I-Leave-Off session resume overview', () => {
      const goal = container.goalService.createGoal('Main Goal', 'Verbatim prompt', '/test/project');
      const t1 = container.taskLifecycleService.createTask({
        title: 'In progress task',
        goalId: goal.id,
        acceptanceCriteria: 'Work on it',
      });

      container.claimService.claimTask(t1.task.id, 'agent-1', 'sess-1');

      const summary = container.sessionService.whereDidILeaveOff('/test/project');
      expect(summary.abandonedDoingTasks.length).toBe(1);
      expect(summary.abandonedDoingTasks[0].id).toBe(t1.task.id);
    });

    it('retrieves file-centric context including active locks, past tasks, decisions, and notes', () => {
      // 1. Record an architectural decision
      container.decisionService.recordDecision({
        title: 'Use Fastify for HTTP Server',
        context: 'High throughput requirement',
        choice: 'Fastify',
        rationale: 'Low overhead and built-in schema validation',
        tags: ['server', 'http', 'api'],
        projectPath: '/test/project',
        authorId: 'architect-1',
      });

      // 2. Create and complete a past task
      const pastTask = container.taskLifecycleService.createTask({
        title: 'Build HTTP Server Base',
        acceptanceCriteria: 'Server starts on port',
        declaredFiles: ['src/server/app.ts'],
      });

      container.claimService.claimTask(pastTask.task.id, 'agent-past', 'sess-past', {
        declaredFiles: ['src/server/app.ts'],
      });

      container.verificationService.completeTask(
        pastTask.task.id,
        'agent-past',
        {
          commandsRun: ['npm test'],
          filesModified: ['src/server/app.ts'],
          outputSnippet: 'Passed',
        },
        'Finished initial Fastify setup'
      );

      // 3. Create and claim an active doing task
      const activeTask = container.taskLifecycleService.createTask({
        title: 'Add REST Routes to Server',
        acceptanceCriteria: 'Routes respond properly',
        declaredFiles: ['src/server/app.ts', 'src/server/routes.ts'],
      });

      container.claimService.claimTask(activeTask.task.id, 'agent-active', 'sess-active', {
        declaredFiles: ['src/server/app.ts', 'src/server/routes.ts'],
      });

      // 4. Query file context for src/server/app.ts
      const context = container.sessionService.getFileContext(['src/server/app.ts'], '/test/project');

      expect(context.filePaths).toEqual(['src/server/app.ts']);
      expect(context.activeLocks.length).toBe(1);
      expect(context.activeLocks[0].taskId).toBe(activeTask.task.id);
      expect(context.activeLocks[0].claimedByAgent).toBe('agent-active');

      expect(context.pastTasks.length).toBe(1);
      expect(context.pastTasks[0].id).toBe(pastTask.task.id);

      expect(context.relevantDecisions.length).toBeGreaterThan(0);
      expect(context.relevantDecisions[0].title).toBe('Use Fastify for HTTP Server');

      expect(context.recentNotes.length).toBeGreaterThan(0);
    });

    it('rejects claiming tasks that are blocked on unmet dependencies', () => {
      const blocker = container.taskLifecycleService.createTask({
        title: 'Prerequisite DB Setup',
        acceptanceCriteria: 'DB ready',
      });
      const blocked = container.taskLifecycleService.createTask({
        title: 'Dependent API Endpoint',
        acceptanceCriteria: 'API ready',
        dependsOnTaskIds: [blocker.task.id],
      });

      expect(() => {
        container.claimService.claimTask(blocked.task.id, 'eager-agent', 'sess-1');
      }).toThrow(TaskBlockedOnDependencyError);
    });

    it('rejects claiming tasks that are paused waiting on human guidance', () => {
      const task = container.taskLifecycleService.createTask({
        title: 'Deploy to Prod',
        acceptanceCriteria: 'Deployment done',
      });

      container.humanCollabService.askHuman(
        task.task.id,
        'agent-1',
        'Please provide production database credentials',
        'credential'
      );

      expect(() => {
        container.claimService.claimTask(task.task.id, 'agent-2', 'sess-2');
      }).toThrow(TaskWaitingOnHumanError);
    });

    it('throws TaskNotFoundError when creating a task with non-existent dependency IDs', () => {
      expect(() => {
        container.taskLifecycleService.createTask({
          title: 'Orphan Dependency Task',
          acceptanceCriteria: 'Valid criteria',
          dependsOnTaskIds: ['task-does-not-exist'],
        });
      }).toThrow(TaskNotFoundError);
    });

    it('re-evaluates dependencies on voluntary release and returns to blocked-on-dependency if blocker is incomplete', () => {
      const blocker = container.taskLifecycleService.createTask({
        title: 'Blocker Service',
        acceptanceCriteria: 'Service online',
      });
      const target = container.taskLifecycleService.createTask({
        title: 'Target Service',
        acceptanceCriteria: 'Target online',
      });

      // Claim target
      container.claimService.claimTask(target.task.id, 'agent-1', 'sess-1');

      // Link dependency while in flight
      container.taskLifecycleService.addDependency(target.task.id, blocker.task.id);

      // Agent releases task voluntarily
      const released = container.claimService.releaseTask(target.task.id, 'agent-1');
      expect(released.status).toBe('blocked-on-dependency');
    });

    it('DatabaseManager invalidates and reconnects when target db path changes', () => {
      const db1 = DatabaseManager.getDatabase({ dbPath: '/tmp/test-path-1/tasks.db' });
      expect(DatabaseManager.getActiveDbPath()).toContain('test-path-1');

      const db2 = DatabaseManager.getDatabase({ dbPath: '/tmp/test-path-2/tasks.db' });
      expect(DatabaseManager.getActiveDbPath()).toContain('test-path-2');
      expect(db1).not.toBe(db2);
      DatabaseManager.close();
    });

    it('manages workspaces in global registry and scopes tasks and goals', () => {
      const ws1 = container.workspaceService.getOrCreateWorkspace('/projects/frontend', 'Frontend App');
      expect(ws1.id).toMatch(/^ws-/);
      expect(ws1.name).toBe('Frontend App');
      expect(ws1.rootPath).toBe('/projects/frontend');

      const ws2 = container.workspaceService.getOrCreateWorkspace('/projects/backend', 'Backend API');
      expect(ws2.id).toMatch(/^ws-/);
      expect(ws2.name).toBe('Backend API');

      const all = container.workspaceService.listWorkspaces();
      expect(all.length).toBeGreaterThanOrEqual(2);

      // Create goal and tasks under ws1
      const g1 = container.goalService.createGoal('Auth UI', 'Build UI', '/projects/frontend', 5, 'PRD', ws1.id);
      const t1 = container.taskLifecycleService.createTask({
        title: 'Login Page Component',
        acceptanceCriteria: 'Login works',
        workspaceId: ws1.id,
        goalId: g1.id,
      });

      // Create goal and tasks under ws2
      const g2 = container.goalService.createGoal('Auth API', 'Build API', '/projects/backend', 5, 'PRD', ws2.id);
      const t2 = container.taskLifecycleService.createTask({
        title: 'POST /auth/login endpoint',
        acceptanceCriteria: 'Returns JWT',
        workspaceId: ws2.id,
        goalId: g2.id,
      });

      // Workspace scoping
      const ws1Tasks = container.taskRepo.list({ workspaceId: ws1.id });
      expect(ws1Tasks.map((t) => t.id)).toContain(t1.task.id);
      expect(ws1Tasks.map((t) => t.id)).not.toContain(t2.task.id);

      const ws2Tasks = container.taskRepo.list({ workspaceId: ws2.id });
      expect(ws2Tasks.map((t) => t.id)).toContain(t2.task.id);
      expect(ws2Tasks.map((t) => t.id)).not.toContain(t1.task.id);

      const ws1Goals = container.goalService.listGoals(undefined, undefined, ws1.id);
      expect(ws1Goals.map((g) => g.id)).toContain(g1.id);
      expect(ws1Goals.map((g) => g.id)).not.toContain(g2.id);

      // Rename / update workspace display name and remote
      const renamed = container.workspaceService.updateWorkspace(ws1.id, {
        name: 'Frontend Web Portal',
        gitRemote: 'https://github.com/org/frontend-portal.git',
      });
      expect(renamed.name).toBe('Frontend Web Portal');
      expect(renamed.gitRemote).toBe('https://github.com/org/frontend-portal.git');

      // Lookup by new name
      const foundByName = container.workspaceService.getWorkspace('Frontend Web Portal');
      expect(foundByName?.id).toBe(ws1.id);

      // Delete workspace
      const deleted = container.workspaceService.deleteWorkspace(ws1.id);
      expect(deleted).toBe(true);
      expect(container.workspaceService.getWorkspaceById(ws1.id)).toBeNull();
    });

    it('auto-links tasks to the primary active goal when goalId is omitted', () => {
      const goal = container.goalService.createGoal('Main Feature Goal', 'Verbatim prompt', '/test/project');
      const created = container.taskLifecycleService.createTask({
        title: 'Task without explicit goalId',
        acceptanceCriteria: 'Criteria',
      });
      expect(created.task.goalId).toBe(goal.id);
    });

    it('surfaces conflict-free unblocked tasks for parallel agents when avoidFileConflicts is enabled', () => {
      const t1 = container.taskLifecycleService.createTask({
        title: 'Auth Controller',
        acceptanceCriteria: 'Auth done',
        priority: 'high',
        declaredFiles: ['src/auth.ts'],
      });
      const t2 = container.taskLifecycleService.createTask({
        title: 'Billing Controller',
        acceptanceCriteria: 'Billing done',
        priority: 'high',
        declaredFiles: ['src/billing.ts'],
      });

      // Agent A claims t1 touching src/auth.ts
      container.claimService.claimTask(t1.task.id, 'agent-A', 'sess-A', {
        declaredFiles: ['src/auth.ts'],
      });

      // Another task also touches src/auth.ts
      const t3 = container.taskLifecycleService.createTask({
        title: 'Auth Middleware Refactor',
        acceptanceCriteria: 'Refactor done',
        priority: 'critical', // higher priority than billing
        declaredFiles: ['src/auth.ts'],
      });

      // Agent B queries for next task with avoidFileConflicts: true
      const nextForB = container.taskLifecycleService.getNextUnblockedTask(undefined, 'agent-B', true);
      expect(nextForB).not.toBeNull();
      // Should pick t2 (Billing) to avoid collision with Agent A on src/auth.ts
      expect(nextForB!.id).toBe(t2.task.id);
    });

    it('injects previous failure notes and hypotheses into ClaimTaskResult on retried tasks', () => {
      const task = container.taskLifecycleService.createTask({
        title: 'Tricky Algorithm Implementation',
        acceptanceCriteria: 'Algorithm works',
      });

      // First attempt claims and logs failure
      container.claimService.claimTask(task.task.id, 'agent-1', 'sess-1');
      container.taskLifecycleService.logAttemptFailure({
        taskId: task.task.id,
        agentId: 'agent-1',
        errorSnippet: 'TypeError: Cannot read properties of undefined',
        hypothesis: 'Missing null check in parser',
        nextAttemptPlan: 'Add optional chaining operator',
      });
      container.claimService.releaseTask(task.task.id, 'agent-1');

      // Second attempt claims task
      const claim2 = container.claimService.claimTask(task.task.id, 'agent-2', 'sess-2');
      expect(claim2.attemptCount).toBeGreaterThanOrEqual(2);
      expect(claim2.previousFailureHistory).toBeDefined();
      expect(claim2.previousFailureHistory!.length).toBeGreaterThan(0);
      expect(claim2.previousFailureHistory![0].content).toContain('TypeError');
    });

    it('stores and retrieves multi-choice selectable options for human questions', () => {
      const task = container.taskLifecycleService.createTask({
        title: 'Select DB Architecture',
        acceptanceCriteria: 'Architecture chosen',
      });

      const asked = container.humanCollabService.askHuman(
        task.task.id,
        'architect-agent',
        'Which cache engine should we use?',
        'decision',
        ['Redis Cluster', 'DragonflyDB', 'In-Memory LRU']
      );

      expect(asked.humanOptions).toEqual(['Redis Cluster', 'DragonflyDB', 'In-Memory LRU']);
      expect(asked.status).toBe('waiting-on-human');

      // Verify persistence in repository
      const reloaded = container.taskRepo.findById(task.task.id);
      expect(reloaded!.humanOptions).toEqual(['Redis Cluster', 'DragonflyDB', 'In-Memory LRU']);
    });

    it('supports ultra-dense, standard, and full verbosity in getCompactContext', () => {
      const goal = container.goalService.createGoal('Context Test Goal', 'Full verbatim prompt text', '/test/project');
      const task = container.taskLifecycleService.createTask({
        title: 'Context Test Task',
        goalId: goal.id,
        acceptanceCriteria: 'Criteria text',
      });

      const ultraDense = container.sessionService.getCompactContext('/test/project', undefined, 'ultra-dense');
      expect(ultraDense).toContain('[MOO CONTEXT]');
      expect(ultraDense).toContain('Goal:');
      expect(ultraDense).toContain('Ready:');

      const standard = container.sessionService.getCompactContext('/test/project', undefined, 'standard');
      expect(standard).toContain('# 🐮 MOO TASKS CONTEXT');
      expect(standard).toContain('## 🎯 ACTIVE GOAL');

      const full = container.sessionService.getCompactContext('/test/project', undefined, 'full');
      expect(full).toContain('# 🐮 MOO TASKS CONTEXT');
      expect(full).toContain('Full verbatim prompt text');
    });

    it('imports markdown plans and links sequential phases as dependencies', () => {
      const markdownPlan = `
# Core Feature Implementation

Plan description details.

## Phase 1: Database Setup
- [ ] Create PostgreSQL schema (priority: critical) (files: src/db/schema.sql)
  - Must include users and tasks tables
- [ ] Add migration runner (priority: high)

## Phase 2: Authentication
- [ ] Implement JWT auth middleware (files: src/auth.ts)
- [ ] Add login endpoint
      `;

      const result = container.markdownImportService.importMarkdown(markdownPlan, {
        sequentialPhases: true,
      });

      expect(result.goal).toBeDefined();
      expect(result.goal!.title).toBe('Core Feature Implementation');
      expect(result.importedCount).toBe(4);
      expect(result.tasks[0].priority).toBe('critical');
      expect(result.tasks[0].declaredFiles).toContain('src/db/schema.sql');

      // Phase 2 task should depend on last task of Phase 1
      const phase2FirstTask = result.tasks[2];
      const phase1LastTask = result.tasks[1];
      const deps = container.taskRepo.getDependencies(phase2FirstTask.id);
      expect(deps).toContain(phase1LastTask.id);
    });

    it('performs full-text search across tasks and decisions with BM25 ranking', () => {
      container.taskLifecycleService.createTask({
        title: 'Implement OAuth2 Google Authentication Provider',
        acceptanceCriteria: 'Users can log in with Google OAuth token',
      });

      container.decisionService.recordDecision({
        title: 'Use Better-SQLite3 for Embedded Engine',
        context: 'High-concurrency file lock requirements',
        choice: 'better-sqlite3 WAL mode',
        rationale: 'Sub-millisecond latency and zero external server dependency',
        tags: ['database', 'sqlite'],
        projectPath: '/test/search',
        authorId: 'agent',
      });

      const searchTasks = container.searchService.search('Google OAuth');
      expect(searchTasks.total).toBeGreaterThan(0);
      expect(searchTasks.results[0].title).toContain('Google Authentication');

      const searchDecisions = container.searchService.search('better-sqlite3');
      expect(searchDecisions.total).toBeGreaterThan(0);
      expect(searchDecisions.results[0].type).toBe('decision');
    });

    it('syncs architectural decisions to numbered markdown files in docs/adr/', () => {
      const fs = require('fs');
      const path = require('path');
      const tempDir = path.join(process.cwd(), '.temp-test-adr-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        const syncContainer = createServiceContainer({ projectPath: tempDir, inMemory: true });
        syncContainer.decisionService.recordDecision({
          title: 'Adopt Fastify for HTTP API Server',
          context: 'Need lightweight high-throughput HTTP server for local Web UI',
          choice: 'Fastify v4',
          rationale: 'Superior request throughput and low memory footprint',
          tags: ['architecture', 'api'],
          projectPath: tempDir,
          authorId: 'agent-adr',
        });

        const adrDir = path.join(tempDir, 'docs', 'adr');
        expect(fs.existsSync(adrDir)).toBe(true);
        const files = fs.readdirSync(adrDir);
        expect(files.length).toBe(1);
        expect(files[0]).toContain('0001-adopt-fastify-for-http-api-server.md');

        const content = fs.readFileSync(path.join(adrDir, files[0]), 'utf-8');
        expect(content).toContain('# 1. Adopt Fastify for HTTP API Server');
        expect(content).toContain('## Context');
        expect(content).toContain('## Decision');
        expect(content).toContain('Fastify v4');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('detects agent thrashing and lease stall warnings in diagnostics', () => {
      const task = container.taskLifecycleService.createTask({
        title: 'Failing Flaky Task',
        acceptanceCriteria: 'Must pass',
      });

      // Claim and log 2 attempt failures
      container.claimService.claimTask(task.task.id, 'agent-1', 'sess-1');
      container.taskLifecycleService.logAttemptFailure({
        taskId: task.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Error: Compilation failed',
      });
      container.claimService.claimTask(task.task.id, 'agent-1', 'sess-1');
      container.taskLifecycleService.logAttemptFailure({
        taskId: task.task.id,
        agentId: 'agent-1',
        errorSnippet: 'Error: Compilation failed again',
      });

      const warnings = container.sessionService.detectAgentStallsAndThrashing();
      const thrashWarning = warnings.find((w) => w.taskId === task.task.id && w.warningType === 'thrashing');
      expect(thrashWarning).toBeDefined();
      expect(thrashWarning!.message).toContain('consecutive automated attempts');
      expect(thrashWarning!.suggestedAction).toContain('Decompose task');
    });
  });

  describe('TaskType & Tags Classification & Filtering', () => {
    it('creates task with default type feature and empty tags', () => {
      const res = container.taskLifecycleService.createTask({
        title: 'Build user settings page',
        acceptanceCriteria: '- [ ] Form renders',
      });

      expect(res.task.type).toBe('feature');
      expect(res.task.tags).toEqual([]);
    });

    it('creates and updates task with specific TaskType and custom tags', () => {
      const res = container.taskLifecycleService.createTask({
        title: 'Fix SQL injection vulnerability in search query',
        type: 'security',
        tags: ['auth', 'security', 'sqlite'],
        priority: 'critical',
        acceptanceCriteria: '- [ ] Parameterize all raw SQL queries',
      });

      expect(res.task.type).toBe('security');
      expect(res.task.tags).toEqual(['auth', 'security', 'sqlite']);
      expect(res.task.priority).toBe('critical');

      // Update type and tags
      const updated = container.taskLifecycleService.updateTask(res.task.id, {
        type: 'bug',
        tags: ['auth', 'patch'],
      });

      expect(updated.type).toBe('bug');
      expect(updated.tags).toEqual(['auth', 'patch']);
    });

    it('filters tasks by type and tag in repository', () => {
      container.taskLifecycleService.createTask({
        title: 'Add JWT login',
        type: 'feature',
        tags: ['auth', 'api'],
        acceptanceCriteria: 'Login works',
      });

      container.taskLifecycleService.createTask({
        title: 'Fix token expiry bug',
        type: 'bug',
        tags: ['auth', 'jwt'],
        acceptanceCriteria: 'Token refreshed',
      });

      container.taskLifecycleService.createTask({
        title: 'Write unit tests for auth',
        type: 'test',
        tags: ['auth', 'unit'],
        acceptanceCriteria: 'Coverage 90%',
      });

      const bugs = container.taskRepo.list({ type: 'bug' });
      expect(bugs.length).toBe(1);
      expect(bugs[0].title).toBe('Fix token expiry bug');

      const jwtTasks = container.taskRepo.list({ tag: 'jwt' });
      expect(jwtTasks.length).toBe(1);
      expect(jwtTasks[0].title).toBe('Fix token expiry bug');

      const authTasks = container.taskRepo.list({ tag: 'auth' });
      expect(authTasks.length).toBe(3);
    });

    it('automatically parses type prefixes and tags in MarkdownPlanParser', () => {
      const md = `
# Core Milestones
- [ ] Fix race condition in connection pool (type: bug) (tags: db, pool) (priority: high)
- [ ] refactor: simplify session cache layer (tags: perf, memory)
- [ ] test: integration tests for auth
      `;

      const result = container.markdownImportService.importMarkdown(md, {
        authorId: 'test-importer',
      });

      expect(result.tasks.length).toBe(3);
      expect(result.tasks[0].type).toBe('bug');
      expect(result.tasks[0].tags).toEqual(['db', 'pool']);
      expect(result.tasks[0].priority).toBe('high');

      expect(result.tasks[1].type).toBe('refactor');
      expect(result.tasks[1].tags).toEqual(['perf', 'memory']);

      expect(result.tasks[2].type).toBe('test');
    });

    it('matches ADR decisions using task tags during task claim', () => {
      container.decisionService.recordDecision({
        title: 'Use Redis for Session Storage',
        context: 'High concurrency session tracking',
        choice: 'Redis cluster',
        rationale: 'Sub-millisecond latency',
        tags: ['session', 'redis', 'cache'],
        projectPath: '/test/project',
        authorId: 'tester',
      });

      const task = container.taskLifecycleService.createTask({
        title: 'Implement session management',
        type: 'feature',
        tags: ['redis', 'session'],
        acceptanceCriteria: 'Sessions stored in redis',
      });

      const claimResult = container.claimService.claimTask(task.task.id, 'agent-1', 'session-1');
      expect(claimResult.relatedDecisions).toBeDefined();
      expect(claimResult.relatedDecisions!.length).toBeGreaterThan(0);
      expect(claimResult.relatedDecisions![0].title).toBe('Use Redis for Session Storage');
    });

    it('resolves tasks by short code sequence (e.g. MO-1, SH-1, 1)', () => {
      const created = container.taskLifecycleService.createTask({
        title: 'Short code test issue',
        acceptanceCriteria: 'Findable by short code',
      });

      const foundByDirectId = container.taskRepo.findById(created.task.id);
      expect(foundByDirectId).toBeDefined();

      const foundByShortCode = container.taskRepo.findById(`MO-${created.task.orderIndex}`);
      expect(foundByShortCode).toBeDefined();
      expect(foundByShortCode!.id).toBe(created.task.id);

      const foundByNumeric = container.taskRepo.findById(String(created.task.orderIndex));
      expect(foundByNumeric).toBeDefined();
      expect(foundByNumeric!.id).toBe(created.task.id);
    });

    it('sanitizes requirement prefixes and extracts priority, type, tags, and files from title or payload', () => {
      // 1. Requirement prefix stripping
      const task1 = container.taskLifecycleService.createTask({
        title: 'C1: Implement OAuth2 login flow',
        acceptanceCriteria: 'OAuth2 working',
      });
      expect(task1.task.title).toBe('Implement OAuth2 login flow');

      // 2. Prefix with priority and tags in title
      const task2 = container.taskLifecycleService.createTask({
        title: 'H2 - fix(auth): Rate limit login attempts (priority: high) [tags: security, api]',
        acceptanceCriteria: 'Rate limiting implemented',
      });
      expect(task2.task.title).toBe('Rate limit login attempts');
      expect(task2.task.type).toBe('bug');
      expect(task2.task.priority).toBe('high');
      expect(task2.task.tags).toContain('auth');
      expect(task2.task.tags).toContain('security');
      expect(task2.task.tags).toContain('api');

      // 3. Explicit payload priority and type override inferred title metadata
      const task3 = container.taskLifecycleService.createTask({
        title: 'UX-3: [BUG] Redesign settings modal (priority: low)',
        type: 'feature',
        priority: 'critical',
        tags: ['frontend'],
        acceptanceCriteria: 'Settings modal refreshed',
      });
      expect(task3.task.title).toBe('Redesign settings modal');
      expect(task3.task.type).toBe('feature'); // explicit payload overrides title
      expect(task3.task.priority).toBe('critical'); // explicit payload overrides title
      expect(task3.task.tags).toContain('frontend');

      // 4. Updating task title also sanitizes title
      const updated = container.taskLifecycleService.updateTask(task1.task.id, {
        title: 'M3 — feat: Add refresh tokens (priority: high)',
      });
      expect(updated.title).toBe('Add refresh tokens');
      expect(updated.type).toBe('feature');
      expect(updated.priority).toBe('high');
    });
  });
});

