import { describe, it, expect, beforeEach } from 'vitest';
import { createServiceContainer, ServiceContainer } from '../services/index.js';
import {
  GoalCapExceededError,
  MissingEvidenceError,
  ParentHasOpenSubtasksError,
  SubtaskNestingError,
  TaskAlreadyClaimedError,
} from '../domain/errors.js';

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
  });
});
