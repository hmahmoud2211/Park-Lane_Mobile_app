import { requireUser } from '../ems/auth.ts';
import { readJson } from '../http/body.ts';
import { authorizeStaff } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { closeParcelAs, logParcel, siteUnitsForStaff, unitParcels, waitingParcels } from '../parcels/parcels.ts';
import { DEFAULT_SITE_ID } from '../repositories/units.ts';
import { cancelPass, checkCode, createPass, listPasses, recordMovement, todaysVisitors } from '../visitors/passes.ts';

/**
 * Visitors and parcels.
 * Residents (their own unit):
 *   GET | POST /api/visitors                       POST /api/visitors/:id/revoke          GET /api/parcels
 * Gate staff (`security`) and admins; `?site=` picks the compound (Park Lane by default):
 *   POST /api/security/visitors/check { code }     GET  /api/security/visitors/today
 *   POST /api/security/visitors/:id/entry | /exit { gate? }
 *   GET  /api/security/parcels                     POST /api/security/parcels { unitId, carrier?, description? }
 *   POST /api/security/parcels/:id/collect | /return     GET /api/security/units
 */
const STAFF = ['security', 'admin'] as const;

export const visitorRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path === '/api/visitors' && method === 'GET') {
    ok(res, listPasses(requireUser(req)));
    return true;
  }
  if (path === '/api/visitors' && method === 'POST') {
    const user = requireUser(req);
    throttle('visitor-pass', user.id);
    ok(res, createPass(user, await readJson(req)));
    return true;
  }
  const revoke = /^\/api\/visitors\/([^/]+)\/revoke$/.exec(path);
  if (revoke && method === 'POST') {
    ok(res, cancelPass(requireUser(req), decodeSegment(revoke[1])));
    return true;
  }
  if (path === '/api/parcels' && method === 'GET') {
    ok(res, unitParcels(requireUser(req)));
    return true;
  }

  if (!path.startsWith('/api/security/')) return false;
  const { user, by } = authorizeStaff(req, STAFF);
  const site = url.searchParams.get('site') ?? DEFAULT_SITE_ID;
  if (path === '/api/security/visitors/check' && method === 'POST') {
    throttle('gate-check', user?.id ?? by);
    ok(res, checkCode((await readJson(req)).code));
    return true;
  }
  if (path === '/api/security/visitors/today' && method === 'GET') {
    ok(res, todaysVisitors(site));
    return true;
  }
  const movement = /^\/api\/security\/visitors\/([^/]+)\/(entry|exit)$/.exec(path);
  if (movement && method === 'POST') {
    ok(res, recordMovement(user, decodeSegment(movement[1]), movement[2] as 'entry' | 'exit', (await readJson(req)).gate));
    return true;
  }
  if (path === '/api/security/parcels' && method === 'GET') {
    ok(res, waitingParcels(site));
    return true;
  }
  if (path === '/api/security/parcels' && method === 'POST') {
    ok(res, logParcel(user, await readJson(req)));
    return true;
  }
  const close = /^\/api\/security\/parcels\/([^/]+)\/(collect|return)$/.exec(path);
  if (close && method === 'POST') {
    ok(res, closeParcelAs(user, decodeSegment(close[1]), close[2] === 'collect' ? 'collected' : 'returned'));
    return true;
  }
  if (path === '/api/security/units' && method === 'GET') {
    ok(res, siteUnitsForStaff(site));
    return true;
  }
  return false;
};
