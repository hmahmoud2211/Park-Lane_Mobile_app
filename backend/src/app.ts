import { createServer, type Server } from 'node:http';

import {
  authenticate,
  bearerOf,
  createAssistantToken,
  createSession,
  createUser,
  requireUser,
  revokeToken,
  verifyCredentials,
} from './ems/auth.ts';
import { clientIp } from './ems/rateLimit.ts';
import { attachRealtime } from './ems/realtime.ts';
import { ApiError } from './errors.ts';
import {
  cancelFlow,
  getFlow,
  listAccounts,
  oauthCallback,
  reconnectAccount,
  refreshAccounts,
  reloadAccount,
  removeAccount,
  startFlow,
  stepFlow,
} from './ha/accounts.ts';
import { attachHub } from './ha/admin.ts';
import { parseCommand } from './ha/commands.ts';
import { homeFor } from './ha/home.ts';
import { OAUTH_BASE_PATH } from './ha/haRest.ts';
import { getHubForUnit, listHubs, runtimeForUser } from './ha/hubs.ts';
import { listIntegrations } from './ha/integrations.ts';
import { deprovisionUnit, provisionUnit } from './ha/provisioner.ts';
import { addMember, createUnit, deleteUnit, getUnit, listUnits } from './ha/units.ts';
import { logAccess } from './http/accessLog.ts';
import { readJson } from './http/body.ts';
import { contextOf, type RequestContext } from './http/context.ts';
import { applyCors } from './http/cors.ts';
import { sendError } from './http/errorHandler.ts';
import { authorizeApiKey, HOME_CALLERS } from './http/guards.ts';
import { throttle } from './http/rateLimits.ts';
import { ok, redirect } from './http/respond.ts';
import { dispatch, type RouteGroup } from './http/router.ts';

/**
 * The Parklane / EMS device backend.
 *
 * EMS (signed-in users):
 *   POST /api/auth/register | /login | /logout     GET /api/auth/me
 *   POST /api/auth/assistant-token                 (a token for the Parklane Assistant, below)
 *   GET  /api/events (WebSocket)
 *
 * The resident's home, served from their unit's Home Assistant (src/ha/):
 *   GET  /api/home
 *   GET  /api/devices                              GET | PATCH /api/devices/:id
 *   POST /api/devices/:id/commands { capability, action, value?, entityId? }
 *   GET  /api/rooms                                POST /api/rooms { name }
 *
 * An assistant token reaches only the reads above and device commands, never
 * unlocks a door, and every command it sends is audited. Everything else
 * needs the app's own session.
 *
 * Linking brand accounts (Home Assistant config flows on the unit's hub):
 *   GET  /api/accounts/integrations                GET /api/accounts
 *   POST /api/accounts/flows { integration }       GET | POST { data } | DELETE /api/accounts/flows/:id
 *   POST /api/accounts/:id/reconnect | /reload     DELETE /api/accounts/:id
 *   POST /api/accounts/refresh                     (reloads every account: picks up devices added in brand apps)
 *   GET  /api/accounts/oauth/auth/external/callback (brand sign-in pages return here)
 *
 * Operations and admin (ADMIN_API_KEY):
 *   GET  /api/health
 *   GET  /api/admin/units                          POST /api/admin/units { name, building?, provision? }
 *   DELETE /api/admin/units/:id                    POST /api/admin/units/:id/provision
 *   POST /api/admin/units/:id/members { email, role? }
 *   GET  /api/admin/hubs                           POST /api/admin/hubs { unitId, baseUrl, token }
 */

const emsRoute: RouteGroup = async ({ req, res, path, method }) => {
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
    ok(res, { user, token: createSession(user.id) });
    return true;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    requireUser(req);
    revokeToken(bearerOf(req));
    ok(res, { signedOut: true });
    return true;
  }
  if (path === '/api/auth/me' && method === 'GET') {
    ok(res, { user: requireUser(req) });
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

const homeRoute: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/home' && method === 'GET') {
    ok(res, homeFor(requireUser(req, HOME_CALLERS).id));
    return true;
  }
  if (path === '/api/devices' && method === 'GET') {
    ok(res, runtimeForUser(requireUser(req, HOME_CALLERS).id).listDevices());
    return true;
  }
  const device = /^\/api\/devices\/([^/]+)(\/commands)?$/.exec(path);
  if (device) {
    // Renaming and moving devices stay with the app.
    const { user, kind } = authenticate(req, method === 'PATCH' ? ['session'] : HOME_CALLERS);
    const id = decodeURIComponent(device[1]);
    if (device[2] && method === 'POST') {
      throttle('device-command', user.id);
      const command = parseCommand(await readJson(req));
      ok(res, await runtimeForUser(user.id).command(user.id, id, command, kind === 'assistant' ? 'assistant' : 'app'));
      return true;
    }
    if (!device[2] && method === 'GET') {
      ok(res, runtimeForUser(user.id).getDevice(id));
      return true;
    }
    if (!device[2] && method === 'PATCH') {
      const body = await readJson(req);
      ok(res, await runtimeForUser(user.id).updateDevice(id, { name: body.name, roomId: body.roomId }));
      return true;
    }
  }
  if (path === '/api/accounts/integrations' && method === 'GET') {
    requireUser(req);
    ok(res, listIntegrations());
    return true;
  }
  if (path === '/api/accounts' && method === 'GET') {
    ok(res, await listAccounts(requireUser(req).id));
    return true;
  }
  if (path === '/api/accounts/flows' && method === 'POST') {
    const user = requireUser(req);
    throttle('account-flow', user.id);
    ok(res, await startFlow(user.id, (await readJson(req)).integration));
    return true;
  }
  const flow = /^\/api\/accounts\/flows\/([^/]+)$/.exec(path);
  if (flow) {
    const user = requireUser(req);
    const flowId = decodeURIComponent(flow[1]);
    if (method === 'GET') {
      ok(res, await getFlow(user.id, flowId));
      return true;
    }
    if (method === 'POST') {
      throttle('account-flow-step', user.id);
      ok(res, await stepFlow(user.id, flowId, (await readJson(req)).data));
      return true;
    }
    if (method === 'DELETE') {
      await cancelFlow(user.id, flowId);
      ok(res, { cancelled: true });
      return true;
    }
  }
  if (path === '/api/accounts/refresh' && method === 'POST') {
    const user = requireUser(req);
    throttle('account-refresh', user.id);
    ok(res, await refreshAccounts(user.id));
    return true;
  }
  const account = /^\/api\/accounts\/([^/]+?)(\/reconnect|\/reload)?$/.exec(path);
  if (account && account[1] !== 'flows' && account[1] !== 'integrations' && account[1] !== 'refresh') {
    const user = requireUser(req);
    const accountId = decodeURIComponent(account[1]);
    if (account[2] === '/reconnect' && method === 'POST') {
      ok(res, { step: await reconnectAccount(user.id, accountId) });
      return true;
    }
    if (account[2] === '/reload' && method === 'POST') {
      await reloadAccount(user.id, accountId);
      ok(res, { reloaded: true });
      return true;
    }
    if (!account[2] && method === 'DELETE') {
      await removeAccount(user.id, accountId);
      ok(res, { removed: true });
      return true;
    }
  }
  if (path === '/api/rooms') {
    const user = requireUser(req, method === 'GET' ? HOME_CALLERS : ['session']);
    if (method === 'GET') {
      ok(res, runtimeForUser(user.id).listRooms());
      return true;
    }
    if (method === 'POST') {
      throttle('room-create', user.id);
      ok(res, await runtimeForUser(user.id).createRoom((await readJson(req)).name));
      return true;
    }
  }
  return false;
};

const opsRoute: RouteGroup = async ({ req, res, path, method }) => {
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

/** Tried in order. Their paths do not overlap, so the order only matters for speed. */
const API_ROUTES: readonly RouteGroup[] = [emsRoute, homeRoute, opsRoute];

async function route(ctx: RequestContext) {
  // Brand sign-in pages send the browser here; it carries no EMS token, the hub checks the state.
  if (ctx.path === `${OAUTH_BASE_PATH}/auth/external/callback` && ctx.req.method === 'GET') {
    redirect(ctx.res, await oauthCallback(ctx.url));
    return;
  }
  if (ctx.path.startsWith('/api/') && (await dispatch(ctx, API_ROUTES))) {
    return;
  }
  throw new ApiError('not_found', 'Not found.');
}

export function createApp(): Server {
  const server = createServer((req, res) => {
    const startedAt = Date.now();
    const ctx = contextOf(req, res);

    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    route(ctx)
      .catch((error: unknown) => sendError(res, error, ctx.path))
      .finally(() => logAccess(req.method, ctx.path, res.statusCode, startedAt));
  });
  attachRealtime(server);
  return server;
}
