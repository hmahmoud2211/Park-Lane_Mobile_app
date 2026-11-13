import { createAccountWithTemporaryPassword, resetToTemporaryPassword } from '../ems/auth.ts';
import { attachGateway } from '../ems/gatewayAccess.ts';
import { gatewayContainerOf, gatewayContainersEnabled, provisionGateway, removeGatewayContainer } from '../ems/gatewayProvisioner.ts';
import { adminRemoveMember } from '../ems/membership.ts';
import { recheckUserConnections } from '../ems/realtime.ts';
import { attachHub } from '../ha/admin.ts';
import { getHubForUnit, listHubs } from '../ha/hubs.ts';
import { deprovisionUnit, provisionUnit } from '../ha/provisioner.ts';
import { addMember, createUnit, deleteUnit, getUnit, listUnits } from '../ha/units.ts';
import { readJson } from '../http/body.ts';
import { log } from '../log.ts';
import { deleteGateway, findGatewayOfUnit, listGateways } from '../repositories/gateways.ts';
import { listMembers, upsertMember } from '../repositories/units.ts';
import { searchUsers } from '../repositories/users.ts';
import { authorizeAdmin, authorizeApiKey } from '../http/guards.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * Operations and admin, with the shared ADMIN_API_KEY or an EMS account with the `admin` role (the dashboard, /admin):
 *   GET  /api/health                               (open while no key is set)
 *   GET  /api/admin/features                       what this server can do: { gatewayContainers }
 *   GET  /api/admin/units                          POST /api/admin/units { name, building?, provision?, gateway? }
 *   DELETE /api/admin/units/:id                    POST /api/admin/units/:id/provision
 *   POST /api/admin/units/:id/gateway { update? }  DELETE /api/admin/units/:id/gateway   (its gateway container)
 *   POST /api/admin/units/:id/members { email, role? }    DELETE /api/admin/units/:id/members/:userId
 *   GET  /api/admin/hubs                           POST /api/admin/hubs { unitId, baseUrl, token }
 *   GET  /api/admin/gateways                       POST /api/admin/gateways { unitId, gatewayId, secret, url? }
 *   DELETE /api/admin/gateways/:id
 *   GET  /api/admin/units/:id                      the unit, its hub, gateway and members
 *   GET  /api/admin/users?q=                       POST /api/admin/users { email, name?, role?, unitId?, unitRole? }
 *   POST /api/admin/users/:id/reset-password
 * Accounts created or reset here get a temporary password, returned once, that must be changed at first sign-in.
 *
 * Access is checked for every /api/admin/ path before it is matched; changes are logged with who made them.
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
  const { by } = authorizeAdmin(req);
  if (method !== 'GET') {
    log.info('admin change', { by, method, path });
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const query = new URL(req.url ?? '/', 'http://admin').searchParams.get('q') ?? '';
    ok(res, searchUsers(query.trim().toLowerCase().slice(0, 100)));
    return true;
  }
  if (path === '/api/admin/users' && method === 'POST') {
    const body = await readJson(req);
    const unit = typeof body.unitId === 'string' && body.unitId ? getUnit(body.unitId) : null;
    const created = await createAccountWithTemporaryPassword(body.email, body.name, body.role);
    if (unit) {
      upsertMember(unit.id, created.user.id, body.unitRole === 'member' ? 'member' : 'owner', new Date().toISOString());
    }
    ok(res, { ...created, unitId: unit?.id ?? null });
    return true;
  }
  const reset = /^\/api\/admin\/users\/([^/]+)\/reset-password$/.exec(path);
  if (reset && method === 'POST') {
    const userId = decodeURIComponent(reset[1]);
    const result = await resetToTemporaryPassword(userId);
    recheckUserConnections(userId);
    ok(res, result);
    return true;
  }

  if (path === '/api/admin/features' && method === 'GET') {
    ok(res, { gatewayContainers: gatewayContainersEnabled() });
    return true;
  }
  if (path === '/api/admin/units' && method === 'GET') {
    ok(res, listUnits().map((unit) => ({ ...unit, hub: getHubForUnit(unit.id), gatewayContainer: gatewayContainerOf(unit.id) })));
    return true;
  }
  if (path === '/api/admin/units' && method === 'POST') {
    const body = await readJson(req);
    const unit = createUnit(body.name, body.building);
    const hub = body.provision === false ? null : provisionUnit(unit.id, unit.name);
    // With the unit, when this server makes gateways: started in the background like its Home Assistant.
    const gatewayContainer = body.gateway === false || !gatewayContainersEnabled() ? null : provisionGateway(unit.id, unit.name);
    ok(res, { ...unit, hub, gatewayContainer });
    return true;
  }
  const removal = /^\/api\/admin\/units\/([^/]+)\/members\/([^/]+)$/.exec(path);
  if (removal && method === 'DELETE') {
    ok(res, adminRemoveMember(getUnit(decodeURIComponent(removal[1])).id, decodeURIComponent(removal[2])));
    return true;
  }
  const unit = /^\/api\/admin\/units\/([^/]+)(\/provision|\/members|\/gateway)?$/.exec(path);
  if (unit) {
    const found = getUnit(decodeURIComponent(unit[1]));
    if (!unit[2] && method === 'DELETE') {
      await deprovisionUnit(found.id);
      await removeGatewayContainer(found.id, { forget: true });
      deleteUnit(found.id);
      ok(res, { deleted: true });
      return true;
    }
    if (unit[2] === '/provision' && method === 'POST') {
      ok(res, provisionUnit(found.id, found.name));
      return true;
    }
    if (!unit[2] && method === 'GET') {
      ok(res, {
        ...found,
        hub: getHubForUnit(found.id),
        gateway: findGatewayOfUnit(found.id),
        gatewayContainer: gatewayContainerOf(found.id),
        members: listMembers(found.id),
      });
      return true;
    }
    if (unit[2] === '/gateway' && method === 'POST') {
      const body = await readJson(req);
      ok(res, provisionGateway(found.id, found.name, { update: body.update === true }));
      return true;
    }
    if (unit[2] === '/gateway' && method === 'DELETE') {
      ok(res, { removed: await removeGatewayContainer(found.id) });
      return true;
    }
    if (unit[2] === '/members' && method === 'POST') {
      const body = await readJson(req);
      ok(res, addMember(found.id, body.email, body.role));
      return true;
    }
  }
  if (path === '/api/admin/gateways' && method === 'GET') {
    ok(res, listGateways());
    return true;
  }
  if (path === '/api/admin/gateways' && method === 'POST') {
    const body = await readJson(req);
    ok(res, attachGateway(getUnit(typeof body.unitId === 'string' ? body.unitId : '').id, body.gatewayId, body.secret, body.url));
    return true;
  }
  const gateway = /^\/api\/admin\/gateways\/([^/]+)$/.exec(path);
  if (gateway && method === 'DELETE') {
    ok(res, { deleted: deleteGateway(decodeURIComponent(gateway[1]).toLowerCase()) });
    return true;
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
