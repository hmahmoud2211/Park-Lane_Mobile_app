import type { ServerResponse } from 'node:http';

import { requireUser } from '../ems/auth.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { ok, send } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { myBmsLatest, myBmsSeries, myEnergyLatest, myEnergySeries, secondsToNextSlot, siteBmsLatest } from '../series/api.ts';

/**
 * Quarter-hour series (series/api.ts). Answers can be cached until the next quarter hour, with an ETag of the
 * reading they hold; a matching If-None-Match gets 304.
 *   GET /api/sites/me/bms/latest       GET /api/sites/me/bms/series?metrics=kw,co2&from&to&bucket=15m|1h|1d
 *   GET /api/units/me/energy/latest    GET /api/units/me/energy/series?metrics=total,ac&from&to&bucket=…
 *   GET /api/admin/sites/:id/bms/latest   (building management)
 */
function cached(res: ServerResponse, ifNoneMatch: string | undefined, tag: string, data: unknown): void {
  const headers = { 'Cache-Control': `private, max-age=${secondsToNextSlot()}`, ETag: tag };
  if (ifNoneMatch === tag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  send(res, 200, { ok: true, data }, headers);
}

const tagOf = (kind: string, at: string | undefined) => `"${kind}-${at ?? 'none'}"`;

export const seriesRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (method !== 'GET') return false;
  const ifNoneMatch = req.headers['if-none-match'];
  if (path === '/api/sites/me/bms/latest') {
    const latest = myBmsLatest(requireUser(req));
    cached(res, ifNoneMatch, tagOf('bms', latest?.at), latest);
    return true;
  }
  if (path === '/api/sites/me/bms/series') {
    ok(res, myBmsSeries(requireUser(req), url.searchParams));
    return true;
  }
  if (path === '/api/units/me/energy/latest') {
    const latest = myEnergyLatest(requireUser(req));
    cached(res, ifNoneMatch, tagOf('energy', latest?.at), latest);
    return true;
  }
  if (path === '/api/units/me/energy/series') {
    ok(res, myEnergySeries(requireUser(req), url.searchParams));
    return true;
  }
  const admin = /^\/api\/admin\/sites\/([^/]+)\/bms\/latest$/.exec(path);
  if (admin) {
    authorizeAdmin(req);
    ok(res, siteBmsLatest(decodeSegment(admin[1])));
    return true;
  }
  return false;
};
