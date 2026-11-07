import { requireUser } from '../ems/auth.ts';
import { createInvite, joinWithCode, myUnit, removeMember } from '../ems/membership.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * The resident's apartment and who shares it (src/ems/membership.ts), app sessions only:
 *   GET    /api/unit                        the unit, my role, its members
 *   POST   /api/unit/invites { role? }      an invite code (owners)
 *   POST   /api/unit/join { code }          join a unit with a code
 *   DELETE /api/unit/members/:userId        remove a member (owners)
 */
export const unitRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/unit' && method === 'GET') {
    ok(res, myUnit(requireUser(req)));
    return true;
  }
  if (path === '/api/unit/invites' && method === 'POST') {
    const user = requireUser(req);
    throttle('unit-invite', user.id);
    ok(res, createInvite(user, (await readJson(req)).role));
    return true;
  }
  if (path === '/api/unit/join' && method === 'POST') {
    const user = requireUser(req);
    // Codes are guessable only by trying many: both the account and the address are limited.
    throttle('unit-join', user.id);
    throttle('unit-join', clientIp(req));
    ok(res, joinWithCode(user, (await readJson(req)).code));
    return true;
  }
  const member = /^\/api\/unit\/members\/([^/]+)$/.exec(path);
  if (member && method === 'DELETE') {
    ok(res, removeMember(requireUser(req), decodeURIComponent(member[1])));
    return true;
  }
  return false;
};
