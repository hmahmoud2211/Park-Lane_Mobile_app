import assert from 'node:assert/strict';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * The Parklane Assistant and the unit's CUBE gateway (src/gateway/): an assistant token's device list includes the
 * gateway's devices, its commands reach the gateway through the relay with one signed request each, only allowlisted
 * commands are sent, every one is audited, and the app's own session never goes this way. The fake gateway below
 * checks each request's token as gateway/cube_gateway/accounts.py `device_call` does.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const gatewayPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const ADMIN = 'admin-key-for-gateway-device-tests';
const GW = '5ab716a9-6938-4cc4-ad99-0c6e9206e2e4';
const RELAY_URL = `http://127.0.0.1:${gatewayPort}/relay/v1/g/${GW}`;

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-gateway-devices-')), ADMIN_API_KEY: ADMIN });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

// ---- a fake gateway behind its relay address ----

const fake = {
  key: null as KeyObject | null,
  power: 'on' as 'on' | 'off',
  /** Answer as the relay does when the gateway is offline. */
  down: false,
  /** Refuse every request, as a gateway that lost the backend's key would. */
  refuse: false,
  seen: new Set<string>(),
  calls: [] as { method: string; path: string; sub: string; body: unknown }[],
};

const tv = () => ({
  id: 'dev_tv',
  name: 'Living room TV',
  brand: 'lg',
  model: '75NANO80T6A',
  adapter_id: 'lg_webos',
  category: 'tv',
  room_id: null,
  room: null,
  connection: { status: 'connected', last_error: null },
  capabilities: [
    { key: 'power', type: 'power', label: 'Power', value: fake.power, confirmed: false },
    { key: 'media', type: 'media', label: 'TV', state: fake.power, volume: 20, muted: false, source: 'HDMI 1', sources: ['HDMI 1', 'Netflix'] },
  ],
  readings: [],
  settings: [],
  commands: ['turn_on', 'turn_off', 'set_volume', 'volume_up', 'volume_down', 'mute', 'set_source'],
  pending: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
});

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const refused = (res: ServerResponse) => reply(res, 401, { ok: false, error: { code: 'invalid_call', message: "That request from EMS isn't valid." } });

/** The claims of a valid device call for this request, or null: as the real gateway checks it. */
function check(req: IncomingMessage, path: string): Record<string, unknown> | null {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer emscall.') || !fake.key) return null;
  const [body, signature] = header.slice('Bearer emscall.'.length).split('.');
  if (!body || !signature || !verify(null, Buffer.from(body), fake.key, Buffer.from(signature, 'base64url'))) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
  const now = Date.now() / 1000;
  const fresh = Number(claims.iat) <= now + 120 && Number(claims.exp) > now - 120 && Number(claims.exp) - Number(claims.iat) <= 120;
  const exact = claims.v === 1 && claims.typ === 'device_call' && claims.gw === GW && claims.m === req.method && claims.p === path;
  if (!fresh || !exact || !claims.sub || typeof claims.jti !== 'string' || fake.seen.has(claims.jti)) return null;
  fake.seen.add(claims.jti);
  return claims;
}

async function fakeGateway(req: IncomingMessage, res: ServerResponse) {
  const prefix = `/relay/v1/g/${GW}`;
  const url = req.url ?? '';
  if (!url.startsWith(prefix)) return reply(res, 404, { ok: false, error: { code: 'unknown_gateway' } });
  if (fake.down) return reply(res, 503, { ok: false, error: { code: 'gateway_offline', message: 'The gateway is not connected to the relay.' } });
  const path = url.slice(prefix.length);
  const claims = fake.refuse ? null : check(req, path);
  if (!claims) return refused(res);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : undefined;
  fake.calls.push({ method: req.method ?? '', path, sub: String(claims.sub), body });
  if (req.method === 'GET' && path === '/api/v1/devices') return reply(res, 200, { ok: true, data: [tv()] });
  if (req.method === 'GET' && path === '/api/v1/devices/dev_tv') return reply(res, 200, { ok: true, data: tv() });
  if (req.method === 'POST' && path === '/api/v1/devices/dev_tv/commands') {
    const command = String(body?.command);
    if (command === 'turn_off' || command === 'turn_on') fake.power = command === 'turn_on' ? 'on' : 'off';
    return reply(res, 200, { ok: true, data: { device: tv(), result: { status: 'assumed' } } });
  }
  return reply(res, 404, { ok: false, error: { code: 'not_found', message: 'No such device on this gateway.' } });
}

let server: Server;
let gateway: Server;

before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
  gateway = createServer((req, res) => void fakeGateway(req, res));
  await new Promise<void>((resolve) => gateway.listen(gatewayPort, '127.0.0.1', resolve));
});

after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  gateway.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => gateway.close(resolve));
});

beforeEach(() => {
  resetLimits();
  Object.assign(fake, { power: 'on', down: false, refuse: false });
  fake.calls.length = 0;
});

// ---- the backend's API ----

interface Envelope<T> {
  status: number;
  data: T;
  error?: { code: string; message: string };
}

async function api<T = Record<string, unknown>>(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, ...((await response.json()) as { data: T; error?: { code: string; message: string } }) };
}

interface Resident {
  id: string;
  session: string;
  assistant: string;
}

async function resident(email: string, unitId: string | null, role: 'owner' | 'member' = 'owner'): Promise<Resident> {
  const registered = await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery' } });
  if (unitId) {
    assert.equal((await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email, role } })).status, 200);
  }
  const assistant = await api<{ token: string }>('POST', '/api/auth/assistant-token', { token: registered.data.token });
  return { id: registered.data.user.id, session: registered.data.token, assistant: assistant.data.token };
}

async function unit(name: string): Promise<string> {
  return (await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false } })).data.id;
}

interface DeviceView {
  id: string;
  kind: string;
  integration: string;
  online: boolean;
  lastError: string | null;
  capabilities: { type: string; entityId: string; value?: string; volume?: number | null; sources?: string[] }[];
}

const command = (who: Resident, body: Record<string, unknown>) =>
  api<DeviceView>('POST', '/api/devices/gw.dev_tv/commands', { token: who.assistant, body });

describe('the assistant and the unit gateway', () => {
  let villa: string;
  let owner: Resident;
  let family: Resident;

  before(async () => {
    const key = (await api<{ key: string }>('GET', '/api/gateway/key')).data.key;
    fake.key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key }, format: 'jwk' });
    villa = await unit('My Villa');
    owner = await resident('owner-villa@parklane.test', villa);
    family = await resident('family-villa@parklane.test', villa, 'member');
    const attached = await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId: villa, gatewayId: GW, secret: 'b'.repeat(64), url: RELAY_URL } });
    assert.equal(attached.status, 200);
  });

  test('an assistant token lists the gateway TV beside the hub devices', async () => {
    const listed = await api<DeviceView[]>('GET', '/api/devices', { token: owner.assistant });
    assert.equal(listed.status, 200, listed.error?.message ?? '');
    const found = listed.data.find((device) => device.id === 'gw.dev_tv');
    assert.ok(found, 'the gateway TV is listed');
    assert.equal(found.kind, 'media');
    assert.equal(found.integration, 'cube_gateway');
    assert.equal(found.online, true);
    assert.deepEqual(found.capabilities.map((capability) => capability.type), ['power', 'media']);
    assert.equal(found.capabilities[1].volume, 0.2, 'volume is 0-1, as for Home Assistant players');
    assert.deepEqual(fake.calls, [{ method: 'GET', path: '/api/v1/devices', sub: owner.id, body: undefined }]);

    const one = await api<DeviceView>('GET', '/api/devices/gw.dev_tv', { token: owner.assistant });
    assert.equal(one.status, 200);
    assert.equal(one.data.id, 'gw.dev_tv');
  });

  test('its commands reach the gateway as the gateway commands they mean, and are audited', async () => {
    const off = await command(family, { capability: 'power', action: 'off' });
    assert.equal(off.status, 200, off.error?.message ?? '');
    assert.equal(off.data.capabilities[0].value, 'off');
    assert.equal((await command(family, { capability: 'media', action: 'set_volume', value: 0.35 })).status, 200);
    assert.equal((await command(family, { capability: 'media', action: 'select_source', value: 'Netflix' })).status, 200);
    assert.equal((await command(family, { capability: 'media', action: 'mute', value: true })).status, 200);
    const sent = fake.calls.filter((entry) => entry.method === 'POST');
    assert.deepEqual(
      sent.map((entry) => entry.body),
      [
        { command: 'turn_off', params: {} },
        { command: 'set_volume', params: { volume: 35 } },
        { command: 'set_source', params: { source: 'Netflix' } },
        { command: 'mute', params: { muted: true } },
      ],
    );
    assert.ok(sent.every((entry) => entry.sub === family.id), 'each request is signed for the resident it acts for');
    const audited = db()
      .prepare("SELECT user_id, action, target, via FROM audit_log WHERE hub_id = ? ORDER BY id")
      .all(`gw:${GW}`) as unknown as { user_id: string; action: string; target: string; via: string }[];
    assert.deepEqual(
      audited.map((row) => [row.user_id, row.action, row.target, row.via]),
      [
        [family.id, 'gateway.turn_off', 'dev_tv', 'assistant'],
        [family.id, 'gateway.set_volume', 'dev_tv', 'assistant'],
        [family.id, 'gateway.set_source', 'dev_tv', 'assistant'],
        [family.id, 'gateway.mute', 'dev_tv', 'assistant'],
      ],
    );
  });

  test('only what the device reports, through the allowlist, is ever sent', async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ capability: 'media', action: 'select_source', value: 'YouTube' }, 400, 'bad_request'],
      [{ capability: 'media', action: 'play' }, 409, 'not_available'],
      [{ capability: 'lock', action: 'unlock' }, 409, 'not_available'],
      [{ capability: 'climate', action: 'set_temperature', value: 22 }, 409, 'not_available'],
      [{ capability: 'power', action: 'reboot' }, 409, 'not_available'],
    ];
    for (const [body, status, code] of cases) {
      const refusedCommand = await command(owner, body);
      assert.equal(refusedCommand.status, status, JSON.stringify(body));
      assert.equal(refusedCommand.error?.code, code, JSON.stringify(body));
    }
    assert.equal(fake.calls.filter((entry) => entry.method === 'POST').length, 0, 'nothing refused reached the gateway');
    const bad = await api('POST', '/api/devices/gw..%2F..%2Fauth/commands', { token: owner.assistant, body: { capability: 'power', action: 'on' } });
    assert.equal(bad.status, 404);
  });

  test("the app's session never goes through the backend to the gateway", async () => {
    // This unit has no Home Assistant yet, so the session's list says so, without the gateway's devices.
    const listed = await api('GET', '/api/devices', { token: owner.session });
    assert.equal(listed.error?.code, 'provisioning');
    const sent = await api('POST', '/api/devices/gw.dev_tv/commands', { token: owner.session, body: { capability: 'power', action: 'off' } });
    assert.notEqual(sent.status, 200);
    assert.equal(fake.calls.length, 0);
  });

  test("residents of another apartment can't reach it", async () => {
    const neighbourUnit = await unit('Tower C · 0402');
    const neighbour = await resident('neighbour@parklane.test', neighbourUnit);
    assert.equal((await api('GET', '/api/devices/gw.dev_tv', { token: neighbour.assistant })).status, 404);
    assert.equal((await command(neighbour, { capability: 'power', action: 'off' })).status, 404);
    assert.equal(fake.calls.length, 0);
  });

  test('a gateway that does not answer stays listed, offline, and its commands say why', async () => {
    assert.equal((await api('GET', '/api/devices', { token: owner.assistant })).status, 200); // seen once
    fake.down = true;
    const listed = await api<DeviceView[]>('GET', '/api/devices', { token: owner.assistant });
    assert.equal(listed.status, 200);
    const found = listed.data.find((device) => device.id === 'gw.dev_tv');
    assert.equal(found?.online, false);
    assert.match(found?.lastError ?? '', /not reachable/);
    const sent = await command(owner, { capability: 'power', action: 'off' });
    assert.equal(sent.status, 503);
    assert.equal(sent.error?.code, 'gateway_offline');
  });

  test('a gateway that refuses the backend is reported as such', async () => {
    fake.refuse = true;
    const sent = await command(owner, { capability: 'power', action: 'off' });
    assert.equal(sent.status, 502);
    assert.equal(sent.error?.code, 'gateway_rejected');
  });

  test('a gateway without a relay address has nothing the assistant can reach', async () => {
    const flat = await unit('Tower D · 0101');
    const someone = await resident('flat-d@parklane.test', flat);
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId: flat, gatewayId: '0810268a-65a9-4059-a543-0e1daaa8ab51', secret: 'c'.repeat(64) } });
    const listed = await api<DeviceView[]>('GET', '/api/devices', { token: someone.assistant });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.data, []);
    const sent = await command(someone, { capability: 'power', action: 'on' });
    assert.equal(sent.error?.code, 'gateway_offline');
  });
});
