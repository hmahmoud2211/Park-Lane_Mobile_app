import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { bearerOf, type TokenKind } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { sameSecret } from '../lib/crypto.ts';

/**
 * Who may call what. EMS routes check the user's token themselves (ems/auth.ts
 * requireUser / authenticate) with one of these token lists; the operations routes
 * check the shared admin key.
 */

/** Tokens that may read the home and run device commands: the app's session and the Parklane Assistant's. */
export const HOME_CALLERS: readonly TokenKind[] = ['session', 'assistant'];

/** The shared key that guards the operations routes (not EMS accounts). Health stays open without one. */
export function authorizeApiKey(req: IncomingMessage, { required = false } = {}): void {
  if (!config.apiKey) {
    if (required) {
      throw new ApiError('not_configured', 'Set ADMIN_API_KEY to use the admin API.');
    }
    return;
  }
  if (!sameSecret(bearerOf(req), config.apiKey)) {
    throw new ApiError('unauthorized', 'Missing or wrong API key.');
  }
}
