import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { bearerOf, lookupToken, type Role, type TokenKind, type User } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { sameSecret } from '../lib/crypto.ts';

/**
 * Who may call what. EMS routes check the user's token themselves (ems/auth.ts
 * requireUser / authenticate) with one of these token lists; the operations routes
 * check the shared admin key.
 */

/** Tokens that may read the home and run device commands: the app's session and the Parklane Assistant's. */
export const HOME_CALLERS: readonly TokenKind[] = ['session', 'assistant'];

/**
 * Who may use /api/admin/*: the shared ADMIN_API_KEY (scripts), or an EMS account with the `admin` role that has
 * chosen its own password (the dashboard). Returns who it was, for the log.
 */
export function authorizeAdmin(req: IncomingMessage): { by: string; user: User | null } {
  const token = bearerOf(req);
  if (config.apiKey && token && sameSecret(token, config.apiKey)) {
    return { by: 'api-key', user: null };
  }
  const found = token ? lookupToken(token, ['session']) : null;
  if (found?.user.role === 'admin') {
    if (found.user.mustChangePassword) {
      throw new ApiError('password_change_required', 'Choose your own password first: your account still has a temporary one.');
    }
    return { by: found.user.email, user: found.user };
  }
  if (found) {
    throw new ApiError('forbidden', 'This account is not an admin.');
  }
  throw new ApiError('unauthorized', 'Sign in with an admin account.');
}

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

/**
 * Building staff in the app or the dashboard: one of `roles` (e.g. security at the gate, or an admin), signed in
 * with their own account and past any temporary password. Building management's API key also passes.
 */
export function authorizeStaff(req: IncomingMessage, roles: readonly Role[]): { by: string; user: User | null } {
  const token = bearerOf(req);
  if (config.apiKey && token && sameSecret(token, config.apiKey)) {
    return { by: 'api-key', user: null };
  }
  const found = token ? lookupToken(token, ['session']) : null;
  if (!found) throw new ApiError('unauthorized', 'Sign in again.');
  if (!roles.includes(found.user.role)) throw new ApiError('forbidden', 'This account cannot do that.');
  if (found.user.mustChangePassword) {
    throw new ApiError('password_change_required', 'Choose your own password first: your account still has a temporary one.');
  }
  return { by: found.user.email, user: found.user };
}
