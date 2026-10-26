import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * End to end over HTTP and WebSocket: the EMS registry, the controller,
 * realtime sync, the Alexa voice API, the OAuth server and app-initiated
 * account linking against a stand-in for Amazon (LWA, endpoint discovery and
 * the Skill Enablement API, which redeems our code like Amazon does).
 *
 * Hardware is only ever the virtual adapter or the clearly named test
 * adapter registered below; nothing here touches a physical device.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

const appPort = await freePort();
const amazonPort = await freePort();
const cubePort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const AMAZON = `http://127.0.0.1:${amazonPort}`;

// config.ts reads these once, on first import.
Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-backend-')),
  EMS_PUBLIC_URL: BASE,
  ALEXA_SKILL_ID: 'amzn1.ask.skill.test',
  ALEXA_LWA_CLIENT_ID: 'lwa-client',
  ALEXA_LWA_CLIENT_SECRET: 'lwa-secret',
  ALEXA_OAUTH_CLIENT_ID: 'alexa-client',
  ALEXA_OAUTH_CLIENT_SECRET: 'alexa-secret',
  ALEXA_REDIRECT_URIS: 'https://layla.amazon.com/api/skill/link/TEST',
  APP_RETURN_URL: 'parklane://alexa-link',
  AMAZON_LWA_AUTHORIZE_URL: `${AMAZON}/ap/oa`,
  AMAZON_LWA_TOKEN_URL: `${AMAZON}/auth/o2/token`,
  AMAZON_ALEXA_API_URL: AMAZON,
  DEV_VOICE_TOKEN: '',
  CUBE_URL: `http://127.0.0.1:${cubePort}`,
  CUBE_TOKEN: 'test-cube-token',
});

const { createApp } = await import('../src/app.ts');
const { registerAdapter } = await import('../src/ems/devices.ts');
const { closeDb } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { ApiError } = await import('../src/errors.ts');

// A stand-in for unsupported hardware that never answers.
registerAdapter({
  protocol: 'test-unreachable',
  types: ['plug'],
  simulated: false,
  async prepare() {
    return { config: null, externalId: null, online: true, power: 'off' };
  },
  async setPower() {
    throw new ApiError('device_unreachable', 'Test hardware did not answer.');
  },
});

// ---- Amazon stand-in --------------------------------------------------------------------

const amazon = {
  challenge: '',
  enablement: 'linked' as 'linked' | 'gone' | 'unauthorized',
  refresh: 'ok' as 'ok' | 'invalid_grant',
  accessExpiresIn: 3600,
  deleted: 0,
  /** What Amazon got back from our /oauth/token when it redeemed the EMS code. */
  emsTokens: null as null | { access_token: string; refresh_token: string },
};

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const amazonServer: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', AMAZON);
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/auth/o2/token') {
    const form = new URLSearchParams(await body(req));
    if (form.get('client_id') !== 'lwa-client' || form.get('client_secret') !== 'lwa-secret') {
      return json(401, { error: 'invalid_client' });
    }
    if (form.get('grant_type') === 'authorization_code') {
      const verified = form.get('code') === 'amazon-code' && sha256(form.get('code_verifier') ?? '') === amazon.challenge;
      return verified
        ? json(200, { access_token: 'amazon-access', refresh_token: 'amazon-refresh', expires_in: amazon.accessExpiresIn })
        : json(400, { error: 'invalid_grant' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      return amazon.refresh === 'ok'
        ? json(200, { access_token: 'amazon-access-2', refresh_token: 'amazon-refresh', expires_in: 3600 })
        : json(400, { error: 'invalid_grant' });
    }
  }
  if (url.pathname === '/v1/alexaApiEndpoint') {
    return json(200, { endpoints: [AMAZON] });
  }
  if (url.pathname === '/v1/users/~current/skills/amzn1.ask.skill.test/enablement') {
    if (req.method === 'POST') {
      const request = JSON.parse(await body(req));
      // What Amazon does: redeem the EMS code at our token URL.
      const redeemed = await fetch(`${BASE}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from('alexa-client:alexa-secret').toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: request.accountLinkRequest.authCode,
          redirect_uri: request.accountLinkRequest.redirectUri,
          code_verifier: request.accountLinkRequest.authCodeVerifier,
        }),
      });
      if (!redeemed.ok) {
        return json(400, { message: 'Token exchange with the skill failed.' });
      }
      amazon.emsTokens = await redeemed.json();
      return json(201, { skill: { id: 'amzn1.ask.skill.test', stage: request.stage }, accountLink: { status: 'LINKED' }, status: 'ENABLED' });
    }
    if (req.method === 'GET') {
      if (amazon.enablement === 'gone') {
        return json(404, { message: 'Not found' });
      }
      if (amazon.enablement === 'unauthorized') {
        return json(401, { message: 'Unauthorized' });
      }
      return json(200, { accountLink: { status: 'LINKED' }, status: 'ENABLED' });
    }
    if (req.method === 'DELETE') {
      amazon.deleted += 1;
      return json(200, {});
    }
  }
  json(404, {});
});

// ---- CUBE hub stand-in ------------------------------------------------------------------

/** Two hub devices: a bridged plug that answers, and one whose plug never does (the hub refuses). */
const hub = {
  plug: { serial_number: 'cube-plug-1', name: 'Hall Plug', manufacturer: 'SONOFF', model: 'plug', display_category: 'plug',
    capabilities: [{ capability: 'power', permission: '1100' }], state: { power: { powerState: 'off' } }, online: true },
  dead: { serial_number: 'cube-dead-1', name: 'Dead Plug', manufacturer: 'SONOFF', model: 'plug', display_category: 'plug',
    capabilities: [{ capability: 'power', permission: '1100' }], state: { power: { powerState: 'off' } }, online: true },
  porch: { serial_number: 'cube-plug-2', name: 'Porch Plug', manufacturer: 'SONOFF', model: 'plug', display_category: 'plug',
    capabilities: [{ capability: 'power', permission: '1100' }], state: { power: { powerState: 'off' } }, online: true },
};

const cubeServer: Server = createServer(async (req, res) => {
  const reply = (value: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (req.headers.authorization !== 'Bearer test-cube-token') {
    return reply({ error: 401, data: {} });
  }
  const url = new URL(req.url ?? '/', 'http://cube');
  if (req.method === 'GET' && url.pathname === '/open-api/v2/rest/devices') {
    return reply({ error: 0, data: { device_list: [hub.plug, hub.dead, hub.porch] } });
  }
  const put = /^\/open-api\/v2\/rest\/devices\/(.+)$/.exec(url.pathname);
  if (req.method === 'PUT' && put) {
    const body = JSON.parse(await body_(req));
    if (put[1] === 'cube-dead-1') {
      return reply({ error: 110000, data: {}, message: 'ENDPOINT_UNREACHABLE' });
    }
    hub.plug.state.power.powerState = body.state.power.powerState;
    return reply({ error: 0, data: {} });
  }
  reply({ error: 404, data: {} });
});

async function body_(req: IncomingMessage): Promise<string> {
  return body(req);
}

// ---- Helpers -----------------------------------------------------------------------------

let server: Server;

async function startApp() {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
}

async function stopApp() {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

before(async () => {
  await new Promise<void>((resolve) => amazonServer.listen(amazonPort, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => cubeServer.listen(cubePort, '127.0.0.1', resolve));
  await startApp();
});

after(async () => {
  await stopApp();
  amazonServer.closeAllConnections();
  await new Promise((resolve) => amazonServer.close(resolve));
  cubeServer.closeAllConnections();
  await new Promise((resolve) => cubeServer.close(resolve));
});

beforeEach(() => resetLimits());

interface Envelope<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
  const parsed = (await response.json()) as { ok: boolean; data: T; error?: { code: string; message: string } };
  return { status: response.status, ...parsed };
}

let counter = 0;
async function newUser() {
  counter += 1;
  const result = await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', {
    body: { email: `resident${counter}@example.com`, password: 'correct horse battery', name: `Resident ${counter}` },
  });
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return result.data;
}

interface Device {
  id: string;
  name: string;
  room: string | null;
  power: string;
  pendingPower: string | null;
  online: boolean;
  simulated: boolean;
  isDefault: boolean;
  alexaEnabled: boolean;
  lastError: string | null;
}

async function addVirtual(token: string, name: string, room?: string) {
  const result = await api<Device>('POST', '/api/devices', { token, body: { name, room, type: 'switch', protocol: 'virtual' } });
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return result.data;
}

/** An app session listening on /api/events, collecting what it is pushed. */
async function listen(token: string) {
  const events: Record<string, unknown>[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
  let closeCode = 0;
  const waiters: (() => void)[] = [];
  socket.addEventListener('message', (event) => {
    events.push(JSON.parse(String(event.data)));
    waiters.splice(0).forEach((wake) => wake());
  });
  socket.addEventListener('close', (event) => {
    closeCode = event.code;
    waiters.splice(0).forEach((wake) => wake());
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket error')));
  });
  socket.send(JSON.stringify({ type: 'auth', token }));
  const waitFor = async (match: (event: Record<string, unknown>) => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = events.find(match);
      if (found) {
        return found;
      }
      if (Date.now() > deadline || closeCode) {
        throw new Error(`event not received (close ${closeCode}): ${JSON.stringify(events)}`);
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };
  await waitFor((event) => event.type === 'ready' || event.type === 'error');
  return { socket, events, waitFor, closed: () => closeCode };
}

async function alexaTokensFor(token: string): Promise<{ access_token: string; refresh_token: string }> {
  const start = await api<{ url: string }>('POST', '/api/integrations/alexa/link/start', { token });
  assert.equal(start.status, 200, JSON.stringify(start.error));
  const lwa = new URL(start.data.url);
  amazon.challenge = lwa.searchParams.get('code_challenge') ?? '';
  const callback = await fetch(`${BASE}/alexa/link/callback?code=amazon-code&state=${lwa.searchParams.get('state')}`, {
    redirect: 'manual',
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), 'parklane://alexa-link?result=linked');
  assert.ok(amazon.emsTokens);
  return amazon.emsTokens;
}

const voice = (token: string, body: Record<string, unknown>) =>
  api<Record<string, unknown> & { outcome: string }>('POST', '/api/voice/command', { token, body });

// ---- Tests -------------------------------------------------------------------------------

describe('device registry and app control', () => {
  test('1. registers a virtual device, owned by the user and the default for voice', async () => {
    const { token } = await newUser();
    const device = await addVirtual(token, 'Desk Lamp', 'Office');
    assert.equal(device.simulated, true);
    assert.equal(device.power, 'off');
    assert.equal(device.online, true);
    assert.equal(device.isDefault, true);
    const list = await api<Device[]>('GET', '/api/devices', { token });
    assert.deepEqual(
      list.data.map((entry) => entry.id),
      [device.id],
    );
  });

  test('2–3 and 7. switches on and off from the app; every session gets pending then confirmed state', async () => {
    const { token } = await newUser();
    const device = await addVirtual(token, 'Hall Light');
    const session = await listen(token);

    const on = await api<Device>('POST', `/api/devices/${device.id}/power`, { token, body: { power: 'on' } });
    assert.equal(on.status, 200);
    assert.equal(on.data.power, 'on');
    assert.equal(on.data.pendingPower, null);
    await session.waitFor((event) => (event.device as Device)?.pendingPower === 'on');
    await session.waitFor((event) => (event.device as Device)?.power === 'on' && !(event.device as Device).pendingPower);

    const off = await api<Device>('POST', `/api/devices/${device.id}/power`, { token, body: { power: 'off' } });
    assert.equal(off.data.power, 'off');
    await session.waitFor((event) => (event.device as Device)?.power === 'off' && !(event.device as Device).pendingPower);
    session.socket.close();
  });

  test('rejects malformed commands and edits', async () => {
    const { token } = await newUser();
    const device = await addVirtual(token, 'Fan');
    assert.equal((await api('POST', `/api/devices/${device.id}/power`, { token, body: { power: 'toggle' } })).status, 400);
    assert.equal((await api('PATCH', `/api/devices/${device.id}`, { token, body: { name: '' } })).status, 400);
    assert.equal((await api('POST', '/api/devices', { token, body: { name: 'X', protocol: 'http-anything' } })).status, 400);
  });

  test('8. refuses other users and anonymous callers', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const device = await addVirtual(owner.token, 'Private Plug');
    assert.equal((await api('GET', `/api/devices/${device.id}`)).status, 401);
    assert.equal((await api('GET', `/api/devices/${device.id}`, { token: stranger.token })).status, 404);
    assert.equal(
      (await api('POST', `/api/devices/${device.id}/power`, { token: stranger.token, body: { power: 'on' } })).status,
      404,
    );
    assert.equal((await api('DELETE', `/api/devices/${device.id}`, { token: stranger.token })).status, 404);
    assert.equal((await api<Device>('GET', `/api/devices/${device.id}`, { token: owner.token })).data.power, 'off');
  });

  test('9. a device that does not answer: error, state unchanged, marked offline', async () => {
    const { token } = await newUser();
    const created = await api<Device>('POST', '/api/devices', { token, body: { name: 'Garage Plug', protocol: 'test-unreachable', type: 'plug' } });
    const result = await api<Device>('POST', `/api/devices/${created.data.id}/power`, { token, body: { power: 'on' } });
    assert.equal(result.status, 502);
    assert.equal(result.error?.code, 'device_unreachable');
    const after = await api<Device>('GET', `/api/devices/${created.data.id}`, { token });
    assert.equal(after.data.power, 'off');
    assert.equal(after.data.pendingPower, null);
    assert.equal(after.data.online, false);
    assert.match(after.data.lastError ?? '', /did not answer/);
  });

  test('default device moves, and Alexa access can be turned off per device', async () => {
    const { token } = await newUser();
    const first = await addVirtual(token, 'One');
    const second = await addVirtual(token, 'Two');
    assert.equal(second.isDefault, false);
    await api('PATCH', `/api/devices/${second.id}`, { token, body: { isDefault: true, alexaEnabled: false } });
    const list = await api<Device[]>('GET', '/api/devices', { token });
    const byId = Object.fromEntries(list.data.map((entry) => [entry.id, entry]));
    assert.equal(byId[first.id].isDefault, false);
    assert.equal(byId[second.id].isDefault, true);
    assert.equal(byId[second.id].alexaEnabled, false);
  });
});

describe('account linking and the voice API', () => {
  test('5–6 and 4. links from the app, then Alexa switches devices with its own token', async () => {
    const { token } = await newUser();
    const device = await addVirtual(token, 'Bedroom Light', 'Bedroom');
    const session = await listen(token);
    const alexa = await alexaTokensFor(token);

    const status = await api<{ status: string; via: string }>('GET', '/api/integrations/alexa/status', { token });
    assert.equal(status.data.status, 'linked');
    assert.equal(status.data.via, 'app');

    // 4: only Alexa's EMS token opens the voice API.
    assert.equal((await voice('', { action: 'on' })).status, 401);
    assert.equal((await voice(token, { action: 'on' })).status, 401);
    assert.equal((await api('GET', '/api/devices', { token: alexa.access_token })).status, 401);

    const on = await voice(alexa.access_token, { action: 'on', device: 'bedroom light' });
    assert.equal(on.data.outcome, 'done');
    assert.equal((on.data.device as Device).power, 'on');
    await session.waitFor((event) => (event.device as Device)?.id === device.id && (event.device as Device).power === 'on');

    const off = await voice(alexa.access_token, { action: 'off' });
    assert.equal(off.data.outcome, 'done');
    assert.equal((await api<Device>('GET', `/api/devices/${device.id}`, { token })).data.power, 'off');

    const state = await voice(alexa.access_token, { action: 'status', device: 'bedroom light' });
    assert.equal(state.data.outcome, 'status');
    session.socket.close();
  });

  test('unlinking removes the skill at Amazon and revokes Alexa’s EMS tokens', async () => {
    const { token } = await newUser();
    await addVirtual(token, 'Lamp');
    const alexa = await alexaTokensFor(token);
    const before = amazon.deleted;
    const result = await api<{ status: string; amazonConfirmed: boolean }>('POST', '/api/integrations/alexa/unlink', { token });
    assert.equal(result.data.status, 'unlinked');
    assert.equal(result.data.amazonConfirmed, true);
    assert.equal(amazon.deleted, before + 1);
    assert.equal((await voice(alexa.access_token, { action: 'on' })).status, 401);
  });

  test('10. expired Amazon authorization is reported as expired', async () => {
    const { token } = await newUser();
    amazon.accessExpiresIn = 10; // forces a refresh on the next check
    await alexaTokensFor(token);
    amazon.refresh = 'invalid_grant';
    try {
      const status = await api<{ status: string; lastError: string }>('GET', '/api/integrations/alexa/status?refresh=1', { token });
      assert.equal(status.data.status, 'expired');
      assert.match(status.data.lastError, /Connect Alexa again/);
    } finally {
      amazon.refresh = 'ok';
      amazon.accessExpiresIn = 3600;
    }
  });

  test('a skill disabled in the Alexa app shows as unlinked and its tokens stop working', async () => {
    const { token } = await newUser();
    const alexa = await alexaTokensFor(token);
    amazon.enablement = 'gone';
    try {
      const status = await api<{ status: string }>('GET', '/api/integrations/alexa/status?refresh=1', { token });
      assert.equal(status.data.status, 'unlinked');
      assert.equal((await voice(alexa.access_token, { action: 'status' })).status, 401);
    } finally {
      amazon.enablement = 'linked';
    }
  });

  test('a cancelled Amazon sign-in and a replayed state never link', async () => {
    const { token } = await newUser();
    const start = await api<{ url: string }>('POST', '/api/integrations/alexa/link/start', { token });
    const state = new URL(start.data.url).searchParams.get('state');
    const cancelled = await fetch(`${BASE}/alexa/link/callback?error=access_denied&state=${state}`, { redirect: 'manual' });
    assert.equal(cancelled.headers.get('location'), 'parklane://alexa-link?result=cancelled');
    const replay = await fetch(`${BASE}/alexa/link/callback?code=amazon-code&state=${state}`, { redirect: 'manual' });
    assert.equal(replay.headers.get('location'), 'parklane://alexa-link?result=failed&reason=expired');
    assert.equal((await api<{ status: string }>('GET', '/api/integrations/alexa/status', { token })).data.status, 'unlinked');
  });

  test('9 via voice: offline and unreachable devices are reported, never claimed switched', async () => {
    const { token } = await newUser();
    const alexa = await alexaTokensFor(token);
    const lamp = await addVirtual(token, 'Porch Lamp');
    await api('PATCH', `/api/devices/${lamp.id}`, { token, body: { online: false } });
    assert.equal((await voice(alexa.access_token, { action: 'on', device: 'porch lamp' })).data.outcome, 'offline');
    await api('POST', '/api/devices', { token, body: { name: 'Garage Plug', protocol: 'test-unreachable', type: 'plug' } });
    assert.equal((await voice(alexa.access_token, { action: 'on', device: 'garage plug' })).data.outcome, 'unreachable');
    assert.equal((await api<Device>('GET', `/api/devices/${lamp.id}`, { token })).data.power, 'off');
  });

  test('11. ambiguous, room-qualified, Arabic and default-device requests', async () => {
    const { token } = await newUser();
    const alexa = await alexaTokensFor(token);
    await addVirtual(token, 'Light', 'Bedroom');
    await addVirtual(token, 'Light', 'Kitchen');
    const arabic = await addVirtual(token, 'نور', 'غرفة النوم');

    const ambiguous = await voice(alexa.access_token, { action: 'on', device: 'light' });
    assert.equal(ambiguous.data.outcome, 'ambiguous');
    // «نور» is a light too, so all three are candidates.
    assert.equal((ambiguous.data.candidates as unknown[]).length, 3);

    const kitchen = await voice(alexa.access_token, { action: 'on', device: 'kitchen light' });
    assert.equal(kitchen.data.outcome, 'done');
    assert.equal((kitchen.data.device as Device).room, 'Kitchen');

    // "Bedroom" and «غرفة النوم» are the same room, each with a light: Alexa asks which.
    const byRoom = await voice(alexa.access_token, { action: 'on', device: 'light', room: 'bedroom' });
    assert.equal(byRoom.data.outcome, 'ambiguous');
    assert.equal((byRoom.data.candidates as unknown[]).length, 2);

    const spoken = await voice(alexa.access_token, { action: 'on', device: 'نور غرفة النوم' });
    assert.equal(spoken.data.outcome, 'done');
    assert.equal((spoken.data.device as Device).name, arabic.name);

    // The first device added is the default.
    const plain = await voice(alexa.access_token, { action: 'off' });
    assert.equal(plain.data.outcome, 'done');
    assert.equal((plain.data.device as Device).room, 'Bedroom');

    assert.equal((await voice(alexa.access_token, { action: 'on', device: 'garden sprinkler' })).data.outcome, 'not_found');
  });
});

test('free speech: any dialect, several devices, and "all"', async () => {
  const { token } = await newUser();
  const alexa = await alexaTokensFor(token);
  const light = await addVirtual(token, 'نور', 'غرفة النوم');
  const ac = await addVirtual(token, 'مكيف', 'الصالة');
  const plug = await api<Device>('POST', '/api/devices', { token, body: { name: 'Garage Plug', protocol: 'test-unreachable', type: 'plug' } });
  const say = (utterance: string) => voice(alexa.access_token, { action: 'auto', utterance });
  const power = async (id: string) => (await api<Device>('GET', `/api/devices/${id}`, { token })).data.power;

  const one = await say('لو سمحت ولّعي الضو باوضة النوم');
  assert.equal(one.data.outcome, 'done');
  assert.equal(await power(light.id), 'on');

  const two = await say('شغل التكييف والنور');
  assert.equal(two.data.outcome, 'batch');
  assert.equal((two.data.done as unknown[]).length, 2);
  assert.equal(await power(ac.id), 'on');

  // A device that does not answer is reported among the failures, not as switched.
  const everything = await say('طفي الكل');
  assert.equal(everything.data.outcome, 'batch');
  assert.equal((everything.data.done as unknown[]).length, 2);
  assert.deepEqual((everything.data.failed as { name: string; reason: string }[]).map((entry) => [entry.name, entry.reason]), [['Garage Plug', 'unreachable']]);
  assert.equal(await power(light.id), 'off');
  assert.equal(await power(plug.data.id), 'off');

  assert.equal((await say('النور شغال؟')).data.outcome, 'status');
  const unclear = await say('ابي النور');
  assert.equal(unclear.data.outcome, 'need_action');
  assert.equal((unclear.data.device as Device).name, 'نور');
});

describe('CUBE devices', () => {
  test('a plug on the hub joins EMS, and the app and Alexa switch it through CUBE', async () => {
    const { token } = await newUser();
    const alexa = await alexaTokensFor(token);
    const added = await api<Device>('POST', '/api/devices', { token, body: { name: 'Hall Plug', room: 'Hall', type: 'plug', protocol: 'cube', cube: { serial: 'cube-plug-1' } } });
    assert.equal(added.status, 200, JSON.stringify(added.error));
    assert.equal(added.data.simulated, false);

    const on = await api<Device>('POST', `/api/devices/${added.data.id}/power`, { token, body: { power: 'on' } });
    assert.equal(on.data.power, 'on');
    assert.equal(hub.plug.state.power.powerState, 'on');

    const off = await voice(alexa.access_token, { action: 'auto', utterance: 'طفي الفيش اللي في الممر' });
    assert.equal(off.data.outcome, 'done');
    assert.equal(hub.plug.state.power.powerState, 'off');
  });

  test('the hub refusing (plug unreachable) is reported, not claimed', async () => {
    const { token } = await newUser();
    const added = await api<Device>('POST', '/api/devices', { token, body: { name: 'Dead Plug', type: 'plug', protocol: 'cube', cube: { serial: 'cube-dead-1' } } });
    const result = await api<Device>('POST', `/api/devices/${added.data.id}/power`, { token, body: { power: 'on' } });
    assert.equal(result.status, 502);
    assert.equal(result.error?.code, 'device_unreachable');
    assert.equal((await api<Device>('GET', `/api/devices/${added.data.id}`, { token })).data.power, 'off');
  });

  test('a serial the hub does not have is refused', async () => {
    const { token } = await newUser();
    const missing = await api('POST', '/api/devices', { token, body: { name: 'Ghost', type: 'plug', protocol: 'cube', cube: { serial: 'nope' } } });
    assert.equal(missing.status, 404);
    assert.equal(missing.error?.code, 'device_not_found');
  });

  test('a change the bridge reports (button, CUBE dashboard) reaches the app live', async () => {
    const { token } = await newUser();
    // A hub device belongs to one EMS account; registering it for another is refused (409).
    const added = await api<Device>('POST', '/api/devices', { token, body: { name: 'Porch Plug', type: 'plug', protocol: 'cube', cube: { serial: 'cube-plug-2' } } });
    const { startAdapters } = await import('../src/ems/devices.ts');
    const { plugEvents } = await import('../src/sonoff/bridge.ts');
    startAdapters();
    const session = await listen(token);
    plugEvents.emit('change', { cubeSerial: 'cube-plug-2', power: 'on', online: true });
    await session.waitFor((event) => (event.device as Device)?.id === added.data.id && (event.device as Device).power === 'on');
    plugEvents.emit('change', { cubeSerial: 'cube-plug-2', online: false });
    await session.waitFor((event) => (event.device as Device)?.id === added.data.id && (event.device as Device).online === false);
    session.socket.close();
  });
});

describe('OAuth server', () => {
  const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  const tokenRequest = (form: Record<string, string>, auth = basic('alexa-client', 'alexa-secret')) =>
    fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth },
      body: new URLSearchParams(form),
    });

  test('the sign-in page only redirects to registered URIs, and its codes are single use', async () => {
    await newUser();
    const email = `resident${counter}@example.com`;
    const redirect = 'https://layla.amazon.com/api/skill/link/TEST';
    const bad = await fetch(`${BASE}/oauth/authorize?client_id=alexa-client&response_type=code&redirect_uri=https://evil.example/cb`);
    assert.equal(bad.status, 400);
    const page = await fetch(`${BASE}/oauth/authorize?client_id=alexa-client&response_type=code&state=xyz&redirect_uri=${encodeURIComponent(redirect)}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Link your EMS account/);

    const wrong = await fetch(`${BASE}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'alexa-client', response_type: 'code', redirect_uri: redirect, state: 'xyz', email, password: 'nope' }),
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);

    const signedIn = await fetch(`${BASE}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'alexa-client', response_type: 'code', redirect_uri: redirect, state: 'xyz', email, password: 'correct horse battery' }),
      redirect: 'manual',
    });
    assert.equal(signedIn.status, 302);
    const location = new URL(signedIn.headers.get('location') ?? '');
    assert.equal(location.searchParams.get('state'), 'xyz');
    const code = location.searchParams.get('code') ?? '';

    assert.equal((await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect }, basic('alexa-client', 'wrong'))).status, 401);
    const first = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect });
    assert.equal(first.status, 200);
    const pair = (await first.json()) as { access_token: string; refresh_token: string; expires_in: number };
    assert.equal(pair.expires_in, 3600);
    assert.equal((await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect })).status, 400);

    // Refresh rotates: the old refresh token is spent.
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: pair.refresh_token });
    assert.equal(refreshed.status, 200);
    assert.equal((await tokenRequest({ grant_type: 'refresh_token', refresh_token: pair.refresh_token })).status, 400);
    const status = await api<{ status: string; via: string }>('GET', '/api/integrations/alexa/status', {
      token: (await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'correct horse battery' } })).data.token,
    });
    assert.equal(status.data.status, 'linked');
    assert.equal(status.data.via, 'alexa');
  });

  test('PKCE: a code bound to a challenge needs the matching verifier', async () => {
    const { user } = await newUser();
    const { issueAuthCode } = await import('../src/ems/oauth.ts');
    const redirect = 'https://layla.amazon.com/api/skill/link/TEST';
    const code = issueAuthCode(user.id, 'alexa-client', redirect, sha256('the-right-verifier-the-right-verifier-0000'));
    assert.equal((await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: 'wrong' })).status, 400);
    const again = issueAuthCode(user.id, 'alexa-client', redirect, sha256('the-right-verifier-the-right-verifier-0000'));
    const okay = await tokenRequest({
      grant_type: 'authorization_code',
      code: again,
      redirect_uri: redirect,
      code_verifier: 'the-right-verifier-the-right-verifier-0000',
    });
    assert.equal(okay.status, 200);
  });
});

describe('accounts', () => {
  test('wrong passwords, duplicate accounts and logout', async () => {
    const { token } = await newUser();
    const email = `resident${counter}@example.com`;
    assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'wrong password' } })).status, 401);
    assert.equal((await api('POST', '/api/auth/register', { body: { email, password: 'another password' } })).status, 409);
    assert.equal((await api('POST', '/api/auth/logout', { token })).status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
  });

  test('login is rate limited', async () => {
    let last = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      last = (await api('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever1' } })).status;
    }
    assert.equal(last, 429);
  });
});

describe('persistence and reconnection', () => {
  test('12. devices survive a restart, and a reconnected session gets new events', async () => {
    const { token } = await newUser();
    const device = await addVirtual(token, 'Patio Light');
    await api('POST', `/api/devices/${device.id}/power`, { token, body: { power: 'on' } });
    const first = await listen(token);

    await stopApp();
    closeDb();
    // Lets fetch's connection pool notice the old server's sockets closed before reusing one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await startApp();

    const reloaded = await api<Device>('GET', `/api/devices/${device.id}`, { token });
    assert.equal(reloaded.data.power, 'on');
    assert.equal(reloaded.data.name, 'Patio Light');
    first.socket.close();

    const second = await listen(token);
    await api('POST', `/api/devices/${device.id}/power`, { token, body: { power: 'off' } });
    await second.waitFor((event) => (event.device as Device)?.power === 'off' && !(event.device as Device).pendingPower);
    second.socket.close();
  });

  test('a session with a bad token is refused', async () => {
    const session = await listen('not-a-token');
    assert.equal(session.events[0].type, 'error');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(session.closed(), 4401);
  });
});
