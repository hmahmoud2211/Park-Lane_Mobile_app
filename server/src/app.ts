import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { config } from './config.ts';
import { createSession, createUser, requireUser, revokeToken, bearerOf, verifyCredentials } from './ems/auth.ts';
import { clientIp, limit } from './ems/rateLimit.ts';
import { attachRealtime } from './ems/realtime.ts';
import { ApiError } from './errors.ts';
import { attachHub } from './ha/admin.ts';
import { parseCommand } from './ha/commands.ts';
import { homeFor } from './ha/home.ts';
import { getHubForUnit, listHubs, runtimeForUser } from './ha/hubs.ts';
import { deprovisionUnit, provisionUnit } from './ha/provisioner.ts';
import { addMember, createUnit, deleteUnit, getUnit, listUnits } from './ha/units.ts';
import { ok, readJson, send } from './http.ts';
import { log } from './log.ts';

/**
 * The Parklane / EMS device backend.
 *
 * EMS (signed-in users):
 *   POST /api/auth/register | /login | /logout     GET /api/auth/me
 *   GET  /api/events (WebSocket)
 *
 * The resident's home, served from their unit's Home Assistant (src/ha/):
 *   GET  /api/home
 *   GET  /api/devices                              GET | PATCH /api/devices/:id
 *   POST /api/devices/:id/commands { capability, action, value?, entityId? }
 *   GET  /api/rooms                                POST /api/rooms { name }
 *
 * Operations and admin (ADMIN_API_KEY):
 *   GET  /api/health
 *   GET  /api/admin/units                          POST /api/admin/units { name, building?, provision? }
 *   DELETE /api/admin/units/:id                    POST /api/admin/units/:id/provision
 *   POST /api/admin/units/:id/members { email, role? }
 *   GET  /api/admin/hubs                           POST /api/admin/hubs { unitId, baseUrl, token }
 */

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The shared key that guards the operations routes (not EMS accounts). Health stays open without one. */
function authorizeApiKey(req: IncomingMessage, { required = false } = {}) {
  if (!config.apiKey) {
    if (required) {
      throw new ApiError('not_configured', 'Set ADMIN_API_KEY to use the admin API.');
    }
    return;
  }
  if (!sameSecret(bearerOf(req), config.apiKey)) {
    throw new ApiError('unauthorized', 'Missing or wrong API key.');
  }
}

async function emsRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const method = req.method ?? 'GET';

  if (path === '/api/auth/register' && method === 'POST') {
    limit('auth', clientIp(req), 10, 60_000);
    const body = await readJson(req);
    const user = await createUser(body.email, body.password, body.name);
    ok(res, { user, token: createSession(user.id) });
    return true;
  }
  if (path === '/api/auth/login' && method === 'POST') {
    limit('auth', clientIp(req), 10, 60_000);
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

  return false;
}

async function homeRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const method = req.method ?? 'GET';

  if (path === '/api/home' && method === 'GET') {
    ok(res, homeFor(requireUser(req).id));
    return true;
  }
  if (path === '/api/devices' && method === 'GET') {
    ok(res, runtimeForUser(requireUser(req).id).listDevices());
    return true;
  }
  const device = /^\/api\/devices\/([^/]+)(\/commands)?$/.exec(path);
  if (device) {
    const user = requireUser(req);
    const id = decodeURIComponent(device[1]);
    if (device[2] && method === 'POST') {
      limit('device-command', user.id, 60, 60_000);
      const command = parseCommand(await readJson(req));
      ok(res, await runtimeForUser(user.id).command(user.id, id, command));
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
  if (path === '/api/rooms') {
    const user = requireUser(req);
    if (method === 'GET') {
      ok(res, runtimeForUser(user.id).listRooms());
      return true;
    }
    if (method === 'POST') {
      limit('room-create', user.id, 20, 60_000);
      ok(res, await runtimeForUser(user.id).createRoom((await readJson(req)).name));
      return true;
    }
  }
  return false;
}

async function opsRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const method = req.method ?? 'GET';
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
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  if (
    path.startsWith('/api/') &&
    ((await emsRoute(req, res, path)) || (await homeRoute(req, res, path)) || (await opsRoute(req, res, path)))
  ) {
    return;
  }
  throw new ApiError('not_found', 'Not found.');
}

export function createApp(): Server {
  const server = createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://backend');
    // Never log the query string.
    const logPath = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    route(req, res, url)
      .catch((error: unknown) => {
        const known = error instanceof ApiError ? error : new ApiError('internal', 'Something went wrong.');
        if (!(error instanceof ApiError)) {
          log.error('Unhandled error', { path: logPath, reason: (error as Error).message });
        }
        if (!res.headersSent) {
          send(res, known.status, { ok: false, error: { code: known.code, message: known.message } });
        }
      })
      .finally(() => {
        log.info(`${req.method} ${logPath} ${res.statusCode} ${Date.now() - started}ms`);
      });
  });
  attachRealtime(server);
  return server;
}

