import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { config } from './config.ts';
import * as cube from './cube/cubeClient.ts';
import { canSwitch, toApiDevice } from './devices.ts';
import * as alexaLink from './ems/alexaLink.ts';
import { createSession, createUser, requireUser, revokeToken, bearerOf, verifyCredentials } from './ems/auth.ts';
import * as registry from './ems/devices.ts';
import * as oauth from './ems/oauth.ts';
import { clientIp, limit } from './ems/rateLimit.ts';
import { attachRealtime } from './ems/realtime.ts';
import { voiceCommand, voiceUser } from './ems/voice.ts';
import { ApiError } from './errors.ts';
import { ok, readJson, send } from './http.ts';
import { log } from './log.ts';
import { browser, discover, handleDirective, register } from './sonoff/bridge.ts';
import { directiveSecret } from './sonoff/store.ts';

/**
 * The Parklane / EMS device backend.
 *
 * EMS (signed-in users, see ALEXA_INTEGRATION.md):
 *   POST /api/auth/register | /login | /logout     GET /api/auth/me
 *   GET  /api/devices                              POST /api/devices
 *   GET | PATCH | DELETE /api/devices/:id          POST /api/devices/:id/power { power }
 *   GET  /api/integrations/alexa/status            POST /api/integrations/alexa/link/start | /unlink
 *   GET  /api/events (WebSocket)
 *   POST /api/voice/command                        (the Alexa skill, with its EMS access token)
 *   GET|POST /oauth/authorize   POST /oauth/token  (account linking)
 *   GET  /alexa/link/callback                      (Login with Amazon returns here)
 *
 * CUBE hub and SONOFF bridge (BACKEND_API_KEY, unchanged apart from the /api/cube prefix):
 *   GET  /api/health
 *   GET  /api/cube/devices          GET /api/cube/devices/:id    POST /api/cube/devices/:id/on | /off
 *   POST /api/sonoff/discover       POST /api/sonoff/devices
 *   POST /cube/directive/:secret    (the CUBE hub)
 */

const DEVICE_ID = /^[0-9a-f]{10}$/i;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The shared key that guards the hub and bridge routes (not EMS accounts). */
function authorizeApiKey(req: IncomingMessage) {
  if (!config.apiKey) {
    return;
  }
  if (!sameSecret(bearerOf(req), config.apiKey)) {
    throw new ApiError('unauthorized', 'Missing or wrong API key.');
  }
}

function deviceIdFrom(body: Record<string, unknown>): string {
  const value = body.deviceId;
  if (typeof value !== 'string' || !DEVICE_ID.test(value)) {
    throw new ApiError('bad_request', 'deviceId must be the plug’s 10-character device ID.');
  }
  return value.toLowerCase();
}

function optionalKey(body: Record<string, unknown>): string | undefined {
  const value = body.deviceKey;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new ApiError('bad_request', 'deviceKey is not a valid device key.');
  }
  return value;
}

async function emsRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
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

  if (path === '/api/devices') {
    const user = requireUser(req);
    if (method === 'GET') {
      ok(res, registry.listDevices(user.id));
      return true;
    }
    if (method === 'POST') {
      limit('device-create', user.id, 20, 60_000);
      ok(res, await registry.createDevice(user.id, await readJson(req)));
      return true;
    }
  }

  const device = /^\/api\/devices\/([^/]+)(\/power)?$/.exec(path);
  if (device) {
    const user = requireUser(req);
    const id = decodeURIComponent(device[1]);
    if (device[2] && method === 'POST') {
      limit('device-power', user.id, 60, 60_000);
      const body = await readJson(req);
      ok(res, await registry.setPower(user.id, id, body.power, 'app'));
      return true;
    }
    if (!device[2] && method === 'GET') {
      ok(res, registry.getDevice(user.id, id));
      return true;
    }
    if (!device[2] && method === 'PATCH') {
      ok(res, registry.updateDevice(user.id, id, await readJson(req)));
      return true;
    }
    if (!device[2] && method === 'DELETE') {
      registry.deleteDevice(user.id, id);
      ok(res, { deleted: true });
      return true;
    }
  }

  if (path === '/api/integrations/alexa/status' && method === 'GET') {
    const user = requireUser(req);
    ok(res, await alexaLink.linkStatus(user, url.searchParams.get('refresh') === '1'));
    return true;
  }
  if (path === '/api/integrations/alexa/link/start' && method === 'POST') {
    const user = requireUser(req);
    limit('alexa-link', user.id, 10, 60_000);
    ok(res, alexaLink.startLink(user));
    return true;
  }
  if (path === '/api/integrations/alexa/unlink' && method === 'POST') {
    const user = requireUser(req);
    ok(res, await alexaLink.unlink(user));
    return true;
  }

  if (path === '/api/voice/command' && method === 'POST') {
    const user = voiceUser(req);
    limit('voice', user.id, 60, 60_000);
    ok(res, await voiceCommand(user, await readJson(req)));
    return true;
  }

  return false;
}

async function hubRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const method = req.method ?? 'GET';
  const hubPaths = path === '/api/health' || path.startsWith('/api/cube/') || path.startsWith('/api/sonoff/');
  if (!hubPaths) {
    return false;
  }
  authorizeApiKey(req);

  if (path === '/api/health' && method === 'GET') {
    const reachable = await cube
      .getBridgeInfo()
      .then(() => ({ reachable: true }))
      .catch((error: unknown) => ({ reachable: false, message: (error as Error).message }));
    ok(res, {
      cube: reachable,
      mdns: { listening: browser.listening },
      registrationReady: Boolean(config.publicUrl) && browser.listening,
      alexaLinking: alexaLink.isConfigured(),
    });
    return true;
  }

  if (path === '/api/cube/devices' && method === 'GET') {
    ok(res, (await cube.getDevices()).map(toApiDevice));
    return true;
  }

  const device = /^\/api\/cube\/devices\/([^/]+)(?:\/(on|off))?$/.exec(path);
  if (device) {
    const id = decodeURIComponent(device[1]);
    const found = await cube.getDevice(id);
    if (!found) {
      throw new ApiError('not_found', 'No such device on the hub.');
    }
    if (!device[2] && method === 'GET') {
      ok(res, toApiDevice(found));
      return true;
    }
    if (device[2] && method === 'POST') {
      if (!canSwitch(found)) {
        throw new ApiError('not_controllable', 'The hub cannot switch this device.');
      }
      try {
        await cube.setPower(id, device[2] === 'on');
      } catch (error) {
        // For a plug the bridge drives, the hub fails this when the plug did not answer.
        if (error instanceof ApiError && error.code === 'cube_rejected') {
          throw new ApiError('device_unreachable', `The hub could not switch the device: ${error.message}`);
        }
        throw error;
      }
      const after = await cube.getDevice(id);
      ok(res, toApiDevice(after ?? found));
      return true;
    }
  }

  if (path === '/api/sonoff/discover' && method === 'POST') {
    const body = await readJson(req);
    const lan = await discover(deviceIdFrom(body), optionalKey(body));
    ok(res, lan ? { found: true, device: lan } : { found: false });
    return true;
  }

  if (path === '/api/sonoff/devices' && method === 'POST') {
    const body = await readJson(req);
    const deviceKey = optionalKey(body);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    if (!deviceKey || !name) {
      throw new ApiError('bad_request', 'deviceKey and name are required.');
    }
    ok(res, await register(deviceIdFrom(body), deviceKey, name));
    return true;
  }

  return false;
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // The hub calls this; it authenticates by the secret in the address we gave it.
  const directive = /^\/cube\/directive\/([^/]+)$/.exec(path);
  if (directive && method === 'POST') {
    if (!sameSecret(directive[1], await directiveSecret())) {
      throw new ApiError('not_found', 'Not found.');
    }
    send(res, 200, await handleDirective((await readJson(req)) as Parameters<typeof handleDirective>[0]));
    return;
  }

  if (path === '/oauth/authorize' && method === 'GET') {
    await oauth.authorizePage(req, res, url);
    return;
  }
  if (path === '/oauth/authorize' && method === 'POST') {
    await oauth.authorizeSubmit(req, res);
    return;
  }
  if (path === '/oauth/token' && method === 'POST') {
    await oauth.token(req, res);
    return;
  }
  if (path === '/alexa/link/callback' && method === 'GET') {
    await alexaLink.linkCallback(res, url);
    return;
  }

  if (path.startsWith('/api/') && ((await emsRoute(req, res, path, url)) || (await hubRoute(req, res, path)))) {
    return;
  }
  throw new ApiError('not_found', 'Not found.');
}

export function createApp(): Server {
  const server = createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://backend');
    // Never log the directive path (the hub's secret) or any query string (codes, states).
    const logPath = url.pathname.startsWith('/cube/directive/') ? '/cube/directive/…' : url.pathname;

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

