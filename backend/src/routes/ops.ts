import { attachHub } from '../ha/admin.ts';
import { getHubForUnit, listHubs } from '../ha/hubs.ts';
import { deprovisionUnit, provisionUnit } from '../ha/provisioner.ts';
import { addMember, createUnit, deleteUnit, getUnit, listUnits } from '../ha/units.ts';
import { readJson } from '../http/body.ts';
import { authorizeApiKey } from '../http/guards.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * Operations and admin, with the shared ADMIN_API_KEY (not EMS accounts):
 *   GET  /api/health                               (open while no key is set)
 *   GET  /api/admin/units                          POST /api/admin/units { name, building?, provision? }
 *   DELETE /api/admin/units/:id                    POST /api/admin/units/:id/provision
 *   POST /api/admin/units/:id/members { email, role? }
 *   GET  /api/admin/hubs                           POST /api/admin/hubs { unitId, baseUrl, token }
 *
 * The key is checked for every /api/admin/ path before it is matched.
 */
export const opsRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/health' && method === 'GET') {
    authorizeApiKey(req);
    ok(res, { status: 'ok' });
    return true;
  }
  if (!path.startsWith('/api/admin/')) {
    return false;
  }
  authorizeApiKey(req, { required: true });

  if (path === '/api/admin/units' && method === 'GET') {
    ok(res, listUnits().map((unit) => ({ ...unit, hub: getHubForUnit(unit.id) })));
    return true;
  }
  if (path === '/api/admin/units' && method === 'POST') {
    const body = await readJson(req);
    const unit = createUnit(body.name, body.building);
    const hub = body.provision === false ? null : provisionUnit(unit.id, unit.name);
    ok(res, { ...unit, hub });
    return true;
  }
  const unit = /^\/api\/admin\/units\/([^/]+)(\/provision|\/members)?$/.exec(path);
  if (unit) {
    const found = getUnit(decodeURIComponent(unit[1]));
    if (!unit[2] && method === 'DELETE') {
      await deprovisionUnit(found.id);
      deleteUnit(found.id);
      ok(res, { deleted: true });
      return true;
    }
    if (unit[2] === '/provision' && method === 'POST') {
      ok(res, provisionUnit(found.id, found.name));
      return true;
    }
    if (unit[2] === '/members' && method === 'POST') {
      const body = await readJson(req);
      ok(res, addMember(found.id, body.email, body.role));
      return true;
    }
  }
  if (path === '/api/admin/hubs' && method === 'GET') {
    ok(res, listHubs());
    return true;
  }
  if (path === '/api/admin/hubs' && method === 'POST') {
    const body = await readJson(req);
    ok(res, await attachHub(typeof body.unitId === 'string' ? body.unitId : '', body.baseUrl, body.token));
    return true;
  }
  return false;
};
