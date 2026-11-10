import { requireUser } from '../ems/auth.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { publicBase } from '../health/files.ts';
import { readJson } from '../http/body.ts';
import { authorizeStaff } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import {
  actOnBooking,
  addVehicle,
  bookParking,
  markParkingRead,
  myVehicles,
  parkingSearch,
  parkingSnapshot,
  removeVehicle,
  securityAct,
  securityCharger,
  securityDesk,
  securityResolve,
  securityScan,
  securitySpace,
  visitorAct,
  visitorPass,
} from '../parking/api.ts';
import { DEFAULT_SITE_ID } from '../repositories/units.ts';

/**
 * Parking (parking/): the rules run here, one atomic step per request.
 * Residents (their own apartment):
 *   GET  /api/parking/snapshot                     the store as the apartment may see it, with its passes' tokens
 *   POST /api/parking/search                       POST /api/parking/reservations
 *   POST /api/parking/reservations/:id/cancel | /replace-pass | /reassign | /share | /plug-in | /stop | /extend | /edit
 *   POST /api/parking/notifications/read           GET | POST /api/parking/vehicles     DELETE /api/parking/vehicles/:id
 * Visitors (no account; the link's token is the key):
 *   GET  /api/parking/pass/:token                  POST /api/parking/pass/:token/plate | /help | /plug-in | /stop
 *   (the page itself is /parking/pass/:token, public/serve.ts)
 * Gate staff (`security`) and admins; `?site=` picks the compound:
 *   GET  /api/security/parking                     POST /api/security/parking/scan { code, gateId, direction }
 *   POST /api/security/parking/reservations/:id/entry | /exit | /moved-out | /reassign | /stop-charging
 *   POST /api/security/parking/spaces/:id/occupancy | /serviceability { state, note }
 *   POST /api/security/parking/chargers/:id/fault | /restore      POST /api/security/parking/alerts/:id/resolve
 */
const BOOKING_ACTIONS = ['cancel', 'replace-pass', 'reassign', 'share', 'plug-in', 'stop', 'extend', 'edit'] as const;
const DESK_ACTIONS = ['entry', 'exit', 'moved-out', 'reassign', 'stop-charging'] as const;
const STAFF = ['security', 'admin'] as const;

export const parkingRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path.startsWith('/api/parking/pass/')) {
    throttle('parking-pass', clientIp(req));
    const pass = /^\/api\/parking\/pass\/([^/]+)(?:\/(plate|help|plug-in|stop))?$/.exec(path);
    if (!pass) return false;
    const token = decodeSegment(pass[1]);
    if (!pass[2] && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      ok(res, visitorPass(token));
      return true;
    }
    if (pass[2] && method === 'POST') {
      ok(res, visitorAct(token, pass[2] as 'plate' | 'help' | 'plug-in' | 'stop', await readJson(req)));
      return true;
    }
    return false;
  }

  if (path.startsWith('/api/parking/')) {
    const user = requireUser(req);
    if (path === '/api/parking/snapshot' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      ok(res, parkingSnapshot(user, publicBase(req)));
      return true;
    }
    if (path === '/api/parking/search' && method === 'POST') {
      ok(res, parkingSearch(user, await readJson(req)));
      return true;
    }
    if (path === '/api/parking/reservations' && method === 'POST') {
      throttle('parking-booking', user.id);
      ok(res, bookParking(user, await readJson(req)));
      return true;
    }
    const booking = /^\/api\/parking\/reservations\/([^/]+)\/([a-z-]+)$/.exec(path);
    if (booking && method === 'POST' && (BOOKING_ACTIONS as readonly string[]).includes(booking[2])) {
      ok(res, actOnBooking(user, decodeSegment(booking[1]), booking[2] as (typeof BOOKING_ACTIONS)[number], await readJson(req)));
      return true;
    }
    if (path === '/api/parking/notifications/read' && method === 'POST') {
      ok(res, markParkingRead(user));
      return true;
    }
    if (path === '/api/parking/vehicles' && method === 'GET') {
      ok(res, myVehicles(user));
      return true;
    }
    if (path === '/api/parking/vehicles' && method === 'POST') {
      ok(res, addVehicle(user, await readJson(req)));
      return true;
    }
    const vehicle = /^\/api\/parking\/vehicles\/([^/]+)$/.exec(path);
    if (vehicle && method === 'DELETE') {
      ok(res, removeVehicle(user, decodeSegment(vehicle[1])));
      return true;
    }
    return false;
  }

  if (!path.startsWith('/api/security/parking')) return false;
  const { user, by } = authorizeStaff(req, STAFF);
  const site = url.searchParams.get('site') ?? DEFAULT_SITE_ID;
  if (path === '/api/security/parking' && method === 'GET') {
    ok(res, securityDesk(site));
    return true;
  }
  if (path === '/api/security/parking/scan' && method === 'POST') {
    throttle('parking-scan', user?.id ?? by);
    ok(res, securityScan(site, await readJson(req)));
    return true;
  }
  const desk = /^\/api\/security\/parking\/reservations\/([^/]+)\/([a-z-]+)$/.exec(path);
  if (desk && method === 'POST' && (DESK_ACTIONS as readonly string[]).includes(desk[2])) {
    ok(res, securityAct(site, decodeSegment(desk[1]), desk[2] as (typeof DESK_ACTIONS)[number], await readJson(req)));
    return true;
  }
  const space = /^\/api\/security\/parking\/spaces\/([^/]+)\/(occupancy|serviceability)$/.exec(path);
  if (space && method === 'POST') {
    ok(res, securitySpace(site, decodeSegment(space[1]), space[2] as 'occupancy' | 'serviceability', await readJson(req)));
    return true;
  }
  const charger = /^\/api\/security\/parking\/chargers\/([^/]+)\/(fault|restore)$/.exec(path);
  if (charger && method === 'POST') {
    ok(res, securityCharger(site, decodeSegment(charger[1]), charger[2] as 'fault' | 'restore'));
    return true;
  }
  const alert = /^\/api\/security\/parking\/alerts\/([^/]+)\/resolve$/.exec(path);
  if (alert && method === 'POST') {
    ok(res, securityResolve(site, decodeSegment(alert[1]), await readJson(req)));
    return true;
  }
  return false;
};
