import {
  bearerOf,
  createAssistantToken,
  createSession,
  createUser,
  requireUser,
  revokeToken,
  verifyCredentials,
} from '../ems/auth.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * EMS accounts:
 *   POST /api/auth/register | /login | /logout     GET /api/auth/me
 *   POST /api/auth/assistant-token                 (a token for the Parklane Assistant)
 */
export const authRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/auth/register' && method === 'POST') {
    throttle('auth', clientIp(req));
    const body = await readJson(req);
    const user = await createUser(body.email, body.password, body.name);
    ok(res, { user, token: createSession(user.id) });
    return true;
  }
  if (path === '/api/auth/login' && method === 'POST') {
    throttle('auth', clientIp(req));
    const body = await readJson(req);
    const user = await verifyCredentials(body.email, body.password);
    ok(res, { user, token: createSession(user.id) });
    return true;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    requireUser(req);
    revokeToken(bearerOf(req));
    ok(res, { signedOut: true });
    return true;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    ok(res, { user: requireUser(req) });
    return true;
  }
  if (path === '/api/auth/assistant-token' && method === 'POST') {
    const user = requireUser(req);
    throttle('assistant-token', user.id);
    ok(res, createAssistantToken(bearerOf(req)));
    return true;
  }

  return false;
};
