import { auditAdmin } from '../ems/adminAudit.ts';
import { requireUser } from '../ems/auth.ts';
import { presentSite, requireSite, requireSiteById, siteSettings, updateSiteSettings } from '../ems/sites.ts';
import { readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { listSites } from '../repositories/sites.ts';
import { currentWeather, weatherEnabled } from '../weather/met.ts';

/**
 * The resident's compound and building management's rules for it:
 *   GET /api/sites/me                              { site, settings }
 *   GET /api/admin/sites                           GET | PUT /api/admin/sites/:id/settings
 *   GET /api/weather                               the compound's weather (MET Norway), or null while it is off
 */
export const siteRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/weather' && method === 'GET') {
    requireUser(req);
    ok(res, weatherEnabled() ? await currentWeather() : null);
    return true;
  }
  if (path === '/api/sites/me' && method === 'GET') {
    const site = requireSite(requireUser(req));
    ok(res, { site: presentSite(site), settings: siteSettings(site.id) });
    return true;
  }
  if (path === '/api/admin/sites' && method === 'GET') {
    authorizeAdmin(req);
    ok(res, listSites().map((site) => ({ ...presentSite(site), settings: siteSettings(site.id) })));
    return true;
  }
  const settings = /^\/api\/admin\/sites\/([^/]+)\/settings$/.exec(path);
  if (settings && (method === 'GET' || method === 'PUT')) {
    const { user } = authorizeAdmin(req);
    const site = requireSiteById(decodeSegment(settings[1]));
    if (method === 'GET') {
      ok(res, siteSettings(site.id));
    } else {
      const body = await readJson(req);
      const next = updateSiteSettings(site.id, body);
      auditAdmin(user, 'site.settings', { type: 'site', id: site.id }, { changed: Object.keys(body) });
      ok(res, next);
    }
    return true;
  }
  return false;
};
