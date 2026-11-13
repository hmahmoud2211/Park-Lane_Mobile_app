import { log } from '../log.ts';

/**
 * Paths that carry a key in the address, logged without it: a family invite code (/join/<code>; new links carry it
 * after #, which never reaches the server) and a visitor's parking pass token, which opens the gate.
 */
const KEYED_PATHS: [RegExp, string][] = [
  [/^\/join\/[^/]+\/?$/, '/join/…'],
  [/^(\/(?:api\/)?parking\/pass\/)[^/]+/, '$1…'],
];

const redact = (path: string) => KEYED_PATHS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), path);

/** One line per request: method, path (never the query string, which can carry secrets), status, time. */
export function logAccess(method: string | undefined, path: string, status: number, startedAt: number): void {
  log.info(`${method} ${redact(path)} ${status} ${Date.now() - startedAt}ms`);
}
