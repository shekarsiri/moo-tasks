import { FastifyInstance } from 'fastify';
import { buildServer } from '../server/app.js';
import { RegisteredContainer } from '../services/index.js';

export const TEST_BOARD_TOKEN = 'test-board-token-0123456789abcdef';

/** A board server whose injected requests carry the board token, as the board page's do. */
export function boardServer(container: RegisteredContainer, options: Parameters<typeof buildServer>[1] = {}): FastifyInstance {
  const app = buildServer(container, { token: TEST_BOARD_TOKEN, ...options });
  const inject = app.inject.bind(app) as (opts: any) => any;
  (app as any).inject = (opts: any) => inject({ ...opts, headers: { 'x-moo-token': TEST_BOARD_TOKEN, ...(opts?.headers || {}) } });
  return app;
}
