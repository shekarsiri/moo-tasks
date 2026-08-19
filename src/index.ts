export * from './domain/types.js';
export * from './domain/errors.js';
export * from './domain/dependency.js';
export * from './domain/conflict.js';
export * from './domain/similarity.js';
export * from './domain/title-sanitizer.js';

export * from './infrastructure/db/database.js';
export * from './infrastructure/db/migrations.js';
export * from './infrastructure/git/git-context.js';
export * from './infrastructure/repositories/interfaces.js';

export * from './services/goal-service.js';
export * from './services/task-lifecycle-service.js';
export * from './services/claim-service.js';
export * from './services/verification-service.js';
export * from './services/human-collab-service.js';
export * from './services/discovered-work-service.js';
export * from './services/decision-service.js';
export * from './services/duplicate-merge-service.js';
export * from './services/session-service.js';
export * from './services/housekeeping-service.js';
export * from './services/index.js';

export * from './mcp/server.js';
export * from './mcp/transport-stdio.js';
export * from './server/app.js';
