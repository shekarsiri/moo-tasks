import { Database as DatabaseType } from 'better-sqlite3';
import { DatabaseConfig, DatabaseManager } from '../infrastructure/db/database.js';
import { DatabaseMigrator } from '../infrastructure/db/migrations.js';
import { SqliteGoalRepository } from '../infrastructure/repositories/sqlite-goal-repo.js';
import { SqliteTaskRepository } from '../infrastructure/repositories/sqlite-task-repo.js';
import { SqliteDecisionRepository } from '../infrastructure/repositories/sqlite-decision-repo.js';
import { SqliteNoteRepository } from '../infrastructure/repositories/sqlite-note-repo.js';
import { SqliteStatusHistoryRepository } from '../infrastructure/repositories/sqlite-status-history-repo.js';
import { GoalService } from './goal-service.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';
import { ClaimService } from './claim-service.js';
import { VerificationService } from './verification-service.js';
import { HumanCollabService } from './human-collab-service.js';
import { DiscoveredWorkService } from './discovered-work-service.js';
import { DecisionService } from './decision-service.js';
import { DuplicateMergeService } from './duplicate-merge-service.js';
import { SessionService } from './session-service.js';
import { HousekeepingService } from './housekeeping-service.js';

export interface ServiceContainer {
  db: DatabaseType;
  projectPath: string;
  
  // Repositories
  goalRepo: SqliteGoalRepository;
  taskRepo: SqliteTaskRepository;
  decisionRepo: SqliteDecisionRepository;
  noteRepo: SqliteNoteRepository;
  statusHistoryRepo: SqliteStatusHistoryRepository;

  // Services
  goalService: GoalService;
  taskLifecycleService: TaskLifecycleService;
  claimService: ClaimService;
  verificationService: VerificationService;
  humanCollabService: HumanCollabService;
  discoveredWorkService: DiscoveredWorkService;
  decisionService: DecisionService;
  duplicateMergeService: DuplicateMergeService;
  sessionService: SessionService;
  housekeepingService: HousekeepingService;
}

export function createServiceContainer(config: DatabaseConfig = {}): ServiceContainer {
  const projectPath = config.projectPath || DatabaseManager.findProjectRoot();
  const db = DatabaseManager.getDatabase(config);
  DatabaseMigrator.runMigrations(db);

  const goalRepo = new SqliteGoalRepository(db);
  const taskRepo = new SqliteTaskRepository(db);
  const decisionRepo = new SqliteDecisionRepository(db);
  const noteRepo = new SqliteNoteRepository(db);
  const statusHistoryRepo = new SqliteStatusHistoryRepository(db);

  const goalService = new GoalService(goalRepo, taskRepo);
  const taskLifecycleService = new TaskLifecycleService(taskRepo, statusHistoryRepo, noteRepo, goalService);
  const claimService = new ClaimService(taskRepo, noteRepo, statusHistoryRepo, decisionRepo);
  const verificationService = new VerificationService(taskRepo, noteRepo, statusHistoryRepo, taskLifecycleService, claimService);
  const humanCollabService = new HumanCollabService(taskRepo, noteRepo, statusHistoryRepo);
  const discoveredWorkService = new DiscoveredWorkService(taskRepo, noteRepo, taskLifecycleService);
  const decisionService = new DecisionService(decisionRepo);
  const duplicateMergeService = new DuplicateMergeService(taskRepo, noteRepo, statusHistoryRepo);
  const sessionService = new SessionService(taskRepo, goalRepo, decisionRepo, taskLifecycleService, noteRepo);
  const housekeepingService = new HousekeepingService(goalRepo, taskRepo, decisionRepo, noteRepo);

  return {
    db,
    projectPath,
    goalRepo,
    taskRepo,
    decisionRepo,
    noteRepo,
    statusHistoryRepo,
    goalService,
    taskLifecycleService,
    claimService,
    verificationService,
    humanCollabService,
    discoveredWorkService,
    decisionService,
    duplicateMergeService,
    sessionService,
    housekeepingService,
  };
}
