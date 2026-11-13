import { requireUser } from '../ems/auth.ts';
import { cancelInvite, checkInvite, createInvite, joinWithCode, listInvites, myUnit, removeMember } from '../ems/membership.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * The resident's apartment and who shares it (src/ems/membership.ts), app sessions only:
 *   GET    /api/unit                        the unit, my role, its members
 *   POST   /api/unit/invites { role? }      an invite code and its link (owners)
 *   GET    /api/unit/invites                invites nobody has used yet (owners)
 *   DELETE /api/unit/invites/:id            cancel one (owners)
 *   POST   /api/unit/invites/check { code } which apartment a code is for, before joining
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
  if (path === '/api/unit/invites' && method === 'GET') {
    ok(res, listInvites(requireUser(req)));
    return true;
  }
  const invite = /^\/api\/unit\/invites\/([A-Za-z0-9_-]{1,32})$/.exec(path);
  if (invite && invite[1] !== 'check' && method === 'DELETE') {
    ok(res, cancelInvite(requireUser(req), invite[1]));
    return true;
  }
  if ((path === '/api/unit/join' || path === '/api/unit/invites/check') && method === 'POST') {
    const user = requireUser(req);
    // Codes are guessable only by trying many: both the account and the address are limited, checking and joining alike.
    throttle('unit-join', user.id);
    throttle('unit-join', clientIp(req));
    const code = (await readJson(req)).code;
    ok(res, path === '/api/unit/join' ? joinWithCode(user, code) : checkInvite(user, code));
    return true;
  }
  const member = /^\/api\/unit\/members\/([^/]+)$/.exec(path);
  if (member && method === 'DELETE') {
    ok(res, removeMember(requireUser(req), decodeURIComponent(member[1])));
    return true;
  }
  return false;
};
