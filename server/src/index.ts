import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { config } from './config.ts';
import * as cube from './cube/cubeClient.ts';
import { canSwitch, toApiDevice } from './devices.ts';
import { ApiError } from './errors.ts';
import { log } from './log.ts';
import { browser, discover, handleDirective, register, startBridge } from './sonoff/bridge.ts';
import { directiveSecret } from './sonoff/store.ts';

/**
 * The Parklane device backend.
 *
 *   GET  /api/health
 *   GET  /api/devices
 *   GET  /api/devices/:id
 *   POST /api/devices/:id/on | /off
 *   POST /api/sonoff/discover   { deviceId, deviceKey? }
 *   POST /api/sonoff/devices    { deviceId, deviceKey, name }
 *   POST /cube/directive/:secret   (the CUBE hub, for plugs the bridge drives)
 */

const MAX_BODY_BYTES = 16 * 1024;
const DEVICE_ID = /^[0-9a-f]{10}$/i;

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

const ok = (res: ServerResponse, data: unknown) => send(res, 200, { ok: true, data });

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError('bad_request', 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  if (size === 0) {
    return {};
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError('bad_request', 'The body must be a JSON object.');
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorize(req: IncomingMessage) {
  if (!config.apiKey) {
    return;
  }
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!sameSecret(given, config.apiKey)) {
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

async function route(req: IncomingMessage, res: ServerResponse, path: string) {
  const method = req.method ?? 'GET';

  // The hub calls this; it authenticates by the secret in the address we gave it.
  const directive = /^\/cube\/directive\/([^/]+)$/.exec(path);
  if (directive && method === 'POST') {
    if (!sameSecret(directive[1], await directiveSecret())) {
      throw new ApiError('not_found', 'Not found.');
    }
    send(res, 200, await handleDirective((await readJson(req)) as Parameters<typeof handleDirective>[0]));
    return;
  }

  if (!path.startsWith('/api/')) {
    throw new ApiError('not_found', 'Not found.');
  }
  authorize(req);

  if (path === '/api/health' && method === 'GET') {
    const reachable = await cube
      .getBridgeInfo()
      .then(() => ({ reachable: true }))
      .catch((error: unknown) => ({ reachable: false, message: (error as Error).message }));
    ok(res, {
      cube: reachable,
      mdns: { listening: browser.listening },
      registrationReady: Boolean(config.publicUrl) && browser.listening,
    });
    return;
  }

  if (path === '/api/devices' && method === 'GET') {
    ok(res, (await cube.getDevices()).map(toApiDevice));
    return;
  }

  const device = /^\/api\/devices\/([^/]+)(?:\/(on|off))?$/.exec(path);
  if (device) {
    const id = decodeURIComponent(device[1]);
    const found = await cube.getDevice(id);
    if (!found) {
      throw new ApiError('not_found', 'No such device on the hub.');
    }
    if (!device[2] && method === 'GET') {
      ok(res, toApiDevice(found));
      return;
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
      return;
    }
  }

  if (path === '/api/sonoff/discover' && method === 'POST') {
    const body = await readJson(req);
    const lan = await discover(deviceIdFrom(body), optionalKey(body));
    ok(res, lan ? { found: true, device: lan } : { found: false });
    return;
  }

  if (path === '/api/sonoff/devices' && method === 'POST') {
    const body = await readJson(req);
    const deviceKey = optionalKey(body);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    if (!deviceKey || !name) {
      throw new ApiError('bad_request', 'deviceKey and name are required.');
    }
    ok(res, await register(deviceIdFrom(body), deviceKey, name));
    return;
  }

  throw new ApiError('not_found', 'Not found.');
}

const server = createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? '/', 'http://backend');
  // Never log the directive path: it carries the hub's secret.
  const logPath = url.pathname.startsWith('/cube/directive/') ? '/cube/directive/…' : url.pathname;

  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  route(req, res, url.pathname)
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

await startBridge();
server.listen(config.port, config.host, () => {
  log.info(`Parklane device backend on http://${config.host}:${config.port}`, {
    cube: config.cube.url,
    publicUrl: config.publicUrl || '(not set: registration disabled)',
    mdns: browser.listening,
    auth: config.apiKey ? 'api key' : 'none',
  });
});
