import { Database as DatabaseType } from 'better-sqlite3';
import { DatabaseConfig, DatabaseManager } from '../infrastructure/db/database.js';
import { DatabaseMigrator } from '../infrastructure/db/migrations.js';
import { Workspace } from '../domain/types.js';
import { SqliteWorkspaceRepository } from '../infrastructure/repositories/sqlite-workspace-repo.js';
import { SqliteGoalRepository } from '../infrastructure/repositories/sqlite-goal-repo.js';
import { SqliteTaskRepository } from '../infrastructure/repositories/sqlite-task-repo.js';
import { SqliteDecisionRepository } from '../infrastructure/repositories/sqlite-decision-repo.js';
import { SqliteNoteRepository } from '../infrastructure/repositories/sqlite-note-repo.js';
import { SqliteStatusHistoryRepository } from '../infrastructure/repositories/sqlite-status-history-repo.js';
import { WorkspaceService } from './workspace-service.js';
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
import { MarkdownImportService } from './markdown-import-service.js';
import { SearchService } from './search-service.js';

export * from './workspace-service.js';
export * from './goal-service.js';
export * from './task-lifecycle-service.js';
export * from './claim-service.js';
export * from './verification-service.js';
export * from './human-collab-service.js';
export * from './discovered-work-service.js';
export * from './decision-service.js';
export * from './duplicate-merge-service.js';
export * from './session-service.js';
export * from './housekeeping-service.js';
export * from './markdown-import-service.js';
export * from './search-service.js';

export interface ServiceContainer {
  db: DatabaseType;
  projectPath: string;
  activeWorkspace: Workspace;
  
  // Repositories
  workspaceRepo: SqliteWorkspaceRepository;
  goalRepo: SqliteGoalRepository;
  taskRepo: SqliteTaskRepository;
  decisionRepo: SqliteDecisionRepository;
  noteRepo: SqliteNoteRepository;
  statusHistoryRepo: SqliteStatusHistoryRepository;

  // Services
  workspaceService: WorkspaceService;
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
  markdownImportService: MarkdownImportService;
  searchService: SearchService;
}

export function createServiceContainer(config: DatabaseConfig = {}): ServiceContainer {
  const projectPath = config.projectPath || DatabaseManager.findProjectRoot();
  const db = DatabaseManager.getDatabase(config);
  DatabaseMigrator.runMigrations(db);

  const workspaceRepo = new SqliteWorkspaceRepository(db);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const activeWorkspace = workspaceService.getOrCreateWorkspace(projectPath);

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
  const markdownImportService = new MarkdownImportService(goalService, taskLifecycleService);
  const searchService = new SearchService(db, taskRepo, decisionRepo);

  return {
    db,
    projectPath,
    activeWorkspace,
    workspaceRepo,
    goalRepo,
    taskRepo,
    decisionRepo,
    noteRepo,
    statusHistoryRepo,
    workspaceService,
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
    markdownImportService,
    searchService,
  };
}
