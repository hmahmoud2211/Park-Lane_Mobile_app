import type { ServerResponse } from 'node:http';

import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { send } from './respond.ts';

/**
 * Answers a failed request: an ApiError with its own code and status, anything else as a
 * 500 `internal` whose details stay in the log.
 */
export function sendError(res: ServerResponse, error: unknown, path: string): void {
  const known = error instanceof ApiError ? error : new ApiError('internal', 'Something went wrong.');
  if (!(error instanceof ApiError)) {
    log.error('Unhandled error', { path, reason: (error as Error).message });
  }
  if (!res.headersSent) {
    send(res, known.status, { ok: false, error: { code: known.code, message: known.message, ...(known.field ? { field: known.field } : {}) } });
  }
}
