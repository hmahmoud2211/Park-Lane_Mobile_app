import { deleteOwnAccount, isDefaultAccount } from '../ems/accountDeletion.ts';
import { bearerOf, changeOwnPassword, createAssistantToken, createSession, createUser, requireUser, revokeToken, verifyCredentials, type User } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { recheckUserConnections } from '../ems/realtime.ts';
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
 *   POST /api/auth/delete-account { password }     (deletes the signed-in resident's account and data)
 *
 * The shared demo account (EMS_DEFAULT_USERNAME) cannot change its password, sign out its other
 * sessions or be deleted: everyone who tries the app, App Review included, signs in with it.
 */

function refuseForDemoAccount(user: User): void {
  if (isDefaultAccount(user)) {
    throw new ApiError('forbidden', 'This is the shared demo account, so this cannot be changed. Create your own account to try it.');
  }
}
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
    refuseForDemoAccount(user);
    const body = await readJson(req);
    const changed = await changeOwnPassword(user, body.currentPassword, body.newPassword, sha256(bearerOf(req)));
    recheckUserConnections(user.id);
    ok(res, { user: changed });
    return true;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const user = requireUser(req, ['session'], { pendingOk: true });
    revokeToken(bearerOf(req));
    // This phone's live updates stop now, not at the next check.
    recheckUserConnections(user.id);
    ok(res, { signedOut: true });
    return true;
  }
  if (path === '/api/auth/logout-others' && method === 'POST') {
    // For a lost phone: every other session of this account ends, and with it that phone's gateway access.
    const user = requireUser(req);
    refuseForDemoAccount(user);
    const keep = sha256(bearerOf(req));
    const others = activeSessionHashes(user.id, Date.now()).filter((hash) => hash !== keep);
    for (const hash of others) {
      revokeTokenAndChildren(hash, Date.now());
    }
    recheckUserConnections(user.id);
    ok(res, { revoked: others.length });
    return true;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    ok(res, { user: requireUser(req, ['session'], { pendingOk: true }) });
    return true;
  }
  if (path === '/api/auth/delete-account' && method === 'POST') {
    // pendingOk: an account still on a temporary password can be deleted too.
    const user = requireUser(req, ['session'], { pendingOk: true });
    throttle('auth', user.id);
    const body = await readJson(req);
    ok(res, await deleteOwnAccount(user, body.password));
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
