import {
  cancelInvite,
  checkInvite,
  createCircle,
  createInvite,
  deleteCircle,
  joinWithCode,
  listCircles,
  listInvites,
  removeMember,
  renameCircle,
  setSharing,
} from '../circles/circles.ts';
import { watchCircle } from '../circles/live.ts';
import { reportLocation } from '../circles/location.ts';
import { bearerOf, createLocationToken, requireUser } from '../ems/auth.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * Family Circle (src/circles/, docs/plans/FAMILY_CIRCLE_PLAN.md), app sessions only unless noted:
 *   GET    /api/circles                              my Circles, their members and the positions I may see
 *   POST   /api/circles { name }                     make a Circle (I am its owner)
 *   PATCH  /api/circles/:id { name }                 rename (owners)
 *   DELETE /api/circles/:id                          delete (owners)
 *   PUT    /api/circles/:id/sharing { sharing }      turn my own sharing in it on or off
 *   POST   /api/circles/:id/invites                  an invite code (owners)
 *   GET    /api/circles/:id/invites                  invites nobody has used yet (owners)
 *   DELETE /api/circles/:id/invites/:inviteId        cancel one (owners)
 *   POST   /api/circles/invites/check { code }       which Circle a code is for, before joining
 *   POST   /api/circles/join { code }                join a Circle with a code
 *   DELETE /api/circles/:id/members/:userId          remove a member (owners), or leave (my own id)
 *   POST   /api/location/report { points, battery }  the phone's latest points and battery (session or location token)
 *   POST   /api/location/token                       a location token for the phone's background task
 *   POST   /api/location/watch { circleId }          the Circle's map is open: its sharing members go live for a minute
 */

const ID = '([A-Za-z0-9-]{1,64})';
const CIRCLE = new RegExp(`^/api/circles/${ID}$`);
const SHARING = new RegExp(`^/api/circles/${ID}/sharing$`);
const INVITES = new RegExp(`^/api/circles/${ID}/invites$`);
const INVITE = new RegExp(`^/api/circles/${ID}/invites/([0-9]{1,15})$`);
const MEMBER = new RegExp(`^/api/circles/${ID}/members/([^/]{1,64})$`);

/** A report carries up to 200 points: more than the 16 KB default body. */
const REPORT_MAX_BYTES = 64 * 1024;

export const circleRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (!path.startsWith('/api/circles') && !path.startsWith('/api/location/')) {
    return false;
  }

  if (path === '/api/location/report' && method === 'POST') {
    // The only route the background task's narrow token may call.
    const user = requireUser(req, ['session', 'location']);
    throttle('location-report', user.id);
    ok(res, reportLocation(user, await readJson(req, REPORT_MAX_BYTES)));
    return true;
  }
  if (path === '/api/location/watch' && method === 'POST') {
    const user = requireUser(req);
    throttle('location-watch', user.id);
    ok(res, watchCircle(user, (await readJson(req)).circleId));
    return true;
  }
  if (path === '/api/location/token' && method === 'POST') {
    const user = requireUser(req);
    throttle('location-token', user.id);
    ok(res, createLocationToken(bearerOf(req)));
    return true;
  }

  if (path === '/api/circles' && method === 'GET') {
    ok(res, listCircles(requireUser(req)));
    return true;
  }
  if (path === '/api/circles' && method === 'POST') {
    const user = requireUser(req);
    ok(res, createCircle(user, (await readJson(req)).name));
    return true;
  }
  if ((path === '/api/circles/join' || path === '/api/circles/invites/check') && method === 'POST') {
    const user = requireUser(req);
    // Codes are guessable only by trying many: both the account and the address are limited.
    throttle('circle-join', user.id);
    throttle('circle-join', clientIp(req));
    const code = (await readJson(req)).code;
    ok(res, path === '/api/circles/join' ? joinWithCode(user, code) : checkInvite(user, code));
    return true;
  }

  const circle = CIRCLE.exec(path);
  if (circle && circle[1] !== 'join' && circle[1] !== 'invites') {
    if (method === 'PATCH') {
      const user = requireUser(req);
      ok(res, renameCircle(user, circle[1], (await readJson(req)).name));
      return true;
    }
    if (method === 'DELETE') {
      ok(res, deleteCircle(requireUser(req), circle[1]));
      return true;
    }
    return false;
  }
  const sharing = SHARING.exec(path);
  if (sharing && method === 'PUT') {
    const user = requireUser(req);
    ok(res, setSharing(user, sharing[1], (await readJson(req)).sharing));
    return true;
  }
  const invites = INVITES.exec(path);
  if (invites && method === 'POST') {
    const user = requireUser(req);
    throttle('circle-invite', user.id);
    ok(res, createInvite(user, invites[1]));
    return true;
  }
  if (invites && method === 'GET') {
    ok(res, listInvites(requireUser(req), invites[1]));
    return true;
  }
  const invite = INVITE.exec(path);
  if (invite && method === 'DELETE') {
    ok(res, cancelInvite(requireUser(req), invite[1], invite[2]));
    return true;
  }
  const member = MEMBER.exec(path);
  if (member && method === 'DELETE') {
    ok(res, removeMember(requireUser(req), member[1], decodeURIComponent(member[2])));
    return true;
  }
  return false;
};
