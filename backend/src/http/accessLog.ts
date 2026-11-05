import { log } from '../log.ts';

/** One line per request: method, path (never the query string, which can carry secrets), status, time. */
export function logAccess(method: string | undefined, path: string, status: number, startedAt: number): void {
  log.info(`${method} ${path} ${status} ${Date.now() - startedAt}ms`);
}
