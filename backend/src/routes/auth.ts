import { bearerOf, changeOwnPassword, createAssistantToken, createSession, createUser, requireUser, revokeToken, verifyCredentials } from '../ems/auth.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { sha256 } from '../ems/secrets.ts';
import { activeSessionHashes, revokeTokenAndChildren } from '../repositories/tokens.ts';

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
    ok(res, { user, token: createSession(user.id, user.role) });
    return true;
  }
  if (path === '/api/auth/change-password' && method === 'POST') {
    const user = requireUser(req, ['session'], { pendingOk: true });
    throttle('auth', user.id);
    const body = await readJson(req);
    ok(res, { user: await changeOwnPassword(user, body.currentPassword, body.newPassword, sha256(bearerOf(req))) });
    return true;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    requireUser(req, ['session'], { pendingOk: true });
    revokeToken(bearerOf(req));
    ok(res, { signedOut: true });
    return true;
  }
  if (path === '/api/auth/logout-others' && method === 'POST') {
    // For a lost phone: every other session of this account ends, and with it that phone's gateway access.
    const user = requireUser(req);
    const keep = sha256(bearerOf(req));
    const others = activeSessionHashes(user.id, Date.now()).filter((hash) => hash !== keep);
    for (const hash of others) {
      revokeTokenAndChildren(hash, Date.now());
    }
    ok(res, { revoked: others.length });
    return true;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    ok(res, { user: requireUser(req, ['session'], { pendingOk: true }) });
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
