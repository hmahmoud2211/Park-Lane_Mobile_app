import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { demoHome, FakeHa } from './fakeHa.ts';

/**
 * The home facade end to end: admin API → units and hubs, residents' REST
 * and realtime, against two stand-in Home Assistant hubs (one per unit).
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const ADMIN = 'admin-key-for-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-ha-')),
  ADMIN_API_KEY: ADMIN,
  HA_ALLOWED_NETWORKS: '127.0.0.0/8',
  HA_COMMAND_TIMEOUT_MS: '600',
});

const { createApp } = await import('../src/app.ts');
const { stopHubs } = await import('../src/ha/hubs.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

const homeA = new FakeHa(demoHome(), 'token-for-home-a-0000');
const homeB = new FakeHa(demoHome('b_'), 'token-for-home-b-0000');
let server: Server;

before(async () => {
  await homeA.listen();
  await homeB.listen();
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});

after(async () => {
  stopHubs();
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await homeA.close();
  await homeB.close();
});

beforeEach(() => resetLimits());

// ---- Helpers -----------------------------------------------------------------------------

interface Envelope<T> {
  status: number;
  ok: boolean;
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
  return { status: response.status, ...((await response.json()) as { ok: boolean; data: T; error?: { code: string; message: string } }) };
}

const admin = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => api<T>(method, path, { token: ADMIN, body });

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 4000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`condition not met: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let counter = 0;
async function resident() {
  counter += 1;
  const email = `ha-resident${counter}@example.com`;
  const result = await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', {
    body: { email, password: 'correct horse battery' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return { ...result.data, email };
}

/** A unit with a resident and a hub that is online. */
async function unitWithHub(name: string, ha: FakeHa, token: string) {
  const person = await resident();
  const unit = await admin<{ id: string }>('POST', '/api/admin/units', { name, provision: false });
  assert.equal(unit.status, 200, JSON.stringify(unit.error));
  assert.equal((await admin('POST', `/api/admin/units/${unit.data.id}/members`, { email: person.email })).status, 200);
  const hub = await admin('POST', '/api/admin/hubs', { unitId: unit.data.id, baseUrl: `http://127.0.0.1:${ha.port}`, token });
  assert.equal(hub.status, 200, JSON.stringify(hub.error));
  await until(
    () => api<{ hub: { status: string } }>('GET', '/api/home', { token: person.token }),
    (home) => home.data?.hub?.status === 'online',
  );
  return { ...person, unitId: unit.data.id };
}

async function listen(token: string) {
  const events: Record<string, unknown>[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
  socket.addEventListener('message', (event) => events.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
  socket.send(JSON.stringify({ type: 'auth', token }));
  await until(async () => events, (list) => list.some((event) => event.type === 'ready'));
  return { socket, events };
}

interface DeviceShape {
  id: string;
  name: string;
  roomId: string | null;
  online: boolean;
  pending: unknown;
  lastError: string | null;
  capabilities: { type: string; value?: unknown; target?: number }[];
}

const capability = (device: DeviceShape, type: string) => device.capabilities.find((entry) => entry.type === type);

// ---- Tests -------------------------------------------------------------------------------

let a: Awaited<ReturnType<typeof unitWithHub>>;
let b: Awaited<ReturnType<typeof unitWithHub>>;

describe('admin API', () => {
  test('needs the admin key', async () => {
    assert.equal((await api('GET', '/api/admin/units')).status, 401);
    assert.equal((await api('GET', '/api/admin/units', { token: 'wrong' })).status, 401);
    assert.equal((await admin('GET', '/api/admin/units')).status, 200);
  });

  test('refuses hub addresses outside HA_ALLOWED_NETWORKS', async () => {
    const unit = await admin<{ id: string }>('POST', '/api/admin/units', { name: 'Elsewhere', provision: false });
    const refused = await admin('POST', '/api/admin/hubs', { unitId: unit.data.id, baseUrl: 'http://8.8.8.8:8123', token: 'x'.repeat(30) });
    assert.equal(refused.status, 403);
    const pathy = await admin('POST', '/api/admin/hubs', { unitId: unit.data.id, baseUrl: 'http://127.0.0.1:1/x', token: 'x'.repeat(30) });
    assert.equal(pathy.status, 400);
  });

  test('a wrong hub token is refused before anything is stored', async () => {
    const unit = await admin<{ id: string }>('POST', '/api/admin/units', { name: 'Bad token', provision: false });
    const refused = await admin('POST', '/api/admin/hubs', { unitId: unit.data.id, baseUrl: `http://127.0.0.1:${homeA.port}`, token: 'not-the-token-0000000000' });
    assert.equal(refused.status, 502);
    assert.equal(refused.error?.code, 'hub_auth');
  });

  test('units with residents and online hubs', async () => {
    a = await unitWithHub('Tower A · 1203', homeA, 'token-for-home-a-0000');
    b = await unitWithHub('Tower B · 0401', homeB, 'token-for-home-b-0000');
    const hubs = await admin<{ status: string; haVersion: string }[]>('GET', '/api/admin/hubs');
    assert.ok(hubs.data.filter((hub) => hub.status === 'online').length >= 2);
  });
});

describe('residents', () => {
  test('without a unit: no_home', async () => {
    const loner = await resident();
    const home = await api('GET', '/api/home', { token: loner.token });
    assert.equal(home.status, 404);
    assert.equal(home.error?.code, 'no_home');
    assert.equal((await api('GET', '/api/devices', { token: loner.token })).status, 404);
  });

  test('home, rooms and devices come from the unit’s own hub', async () => {
    const home = await api<{ unit: { name: string }; rooms: { name: string }[]; deviceCount: number }>('GET', '/api/home', { token: a.token });
    assert.equal(home.data.unit.name, 'Tower A · 1203');
    assert.deepEqual(home.data.rooms.map((room) => room.name), ['Bedroom', 'Living Room']);
    assert.equal(home.data.deviceCount, 6);
    const devices = await api<DeviceShape[]>('GET', '/api/devices', { token: a.token });
    assert.ok(devices.data.some((device) => device.id === 'dev-light'));
    assert.ok(!devices.data.some((device) => device.id.startsWith('b_')));
  });

  test('another unit’s devices are not found', async () => {
    assert.equal((await api('GET', '/api/devices/b_dev-light', { token: a.token })).status, 404);
    const command = await api('POST', '/api/devices/b_dev-light/commands', { token: a.token, body: { capability: 'power', action: 'on' } });
    assert.equal(command.status, 404);
    assert.equal(homeB.calls.length, 0);
  });

  test('a command shows pending to every session, then the state the hub reported', async () => {
    const session = await listen(a.token);
    const result = await api<DeviceShape>('POST', '/api/devices/dev-light/commands', {
      token: a.token,
      body: { capability: 'brightness', action: 'set', value: 40 },
    });
    assert.equal(result.status, 200, JSON.stringify(result.error));
    assert.equal(capability(result.data, 'power')?.value, 'on');
    assert.equal(capability(result.data, 'brightness')?.value, 40);
    assert.equal(result.data.pending, null);
    assert.deepEqual(homeA.calls.at(-1), { domain: 'light', service: 'turn_on', entityId: 'light.ceiling', data: { brightness_pct: 40 } });
    const pushed = session.events.filter((event) => event.type === 'device' && (event.device as DeviceShape).id === 'dev-light');
    assert.ok(pushed.some((event) => (event.device as DeviceShape).pending !== null), 'pending pushed');
    assert.ok(pushed.some((event) => capability(event.device as DeviceShape, 'power')?.value === 'on' && !(event.device as DeviceShape).pending));
    session.socket.close();
  });

  test('changes made at the hub arrive live', async () => {
    const session = await listen(a.token);
    homeA.setState('switch.plug', 'on');
    await until(
      async () => session.events,
      (events) => events.some((event) => event.type === 'device' && capability(event.device as DeviceShape, 'power')?.value === 'on' && (event.device as DeviceShape).id === 'dev-plug'),
    );
    session.socket.close();
  });

  test('refuses commands outside the allowlist without calling the hub', async () => {
    const before = homeA.calls.length;
    const unknown = await api('POST', '/api/devices/dev-light/commands', { token: a.token, body: { capability: 'power', action: 'explode' } });
    assert.equal(unknown.status, 400);
    const missing = await api('POST', '/api/devices/dev-plug/commands', { token: a.token, body: { capability: 'lock', action: 'unlock' } });
    assert.equal(missing.status, 409);
    assert.equal(missing.error?.code, 'not_available');
    assert.equal(homeA.calls.length, before);
  });

  test('a device that fails: error, last state kept, reason on the device', async () => {
    homeA.failing.add('switch.plug');
    const failed = await api('POST', '/api/devices/dev-plug/commands', { token: a.token, body: { capability: 'power', action: 'off' } });
    assert.equal(failed.status, 502);
    assert.equal(failed.error?.code, 'ha_rejected');
    const plug = await api<DeviceShape>('GET', '/api/devices/dev-plug', { token: a.token });
    assert.equal(capability(plug.data, 'power')?.value, 'on');
    assert.equal(plug.data.lastError, 'The device did not respond.');
    assert.equal(plug.data.pending, null);
    homeA.failing.delete('switch.plug');
  });

  test('a device that never reports back is not a failure', async () => {
    homeA.reportBack = false;
    const result = await api<DeviceShape>('POST', '/api/devices/dev-ac/commands', { token: a.token, body: { capability: 'climate', action: 'set_temperature', value: 21 } });
    assert.equal(result.status, 200);
    assert.equal(capability(result.data, 'climate')?.target, 24);
    homeA.reportBack = true;
  });

  test('rename and move a device; both are stored in Home Assistant', async () => {
    const renamed = await api<DeviceShape>('PATCH', '/api/devices/dev-light', { token: a.token, body: { name: 'Reading light', roomId: 'bedroom' } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.error));
    assert.equal(renamed.data.name, 'Reading light');
    assert.equal(renamed.data.roomId, 'bedroom');
    const helper = await api<DeviceShape>('PATCH', '/api/devices/e.input_boolean.guest_mode', { token: a.token, body: { name: 'Visitors' } });
    assert.equal(helper.data.name, 'Visitors');
    assert.equal((await api('PATCH', '/api/devices/dev-light', { token: a.token, body: { roomId: 'garage' } })).status, 400);
  });

  test('create a room', async () => {
    const created = await api<{ id: string; name: string }>('POST', '/api/rooms', { token: a.token, body: { name: 'Kitchen' } });
    assert.equal(created.status, 200, JSON.stringify(created.error));
    assert.equal(created.data.name, 'Kitchen');
    const rooms = await api<{ name: string }[]>('GET', '/api/rooms', { token: a.token });
    assert.ok(rooms.data.some((room) => room.name === 'Kitchen'));
    assert.equal((await api('POST', '/api/rooms', { token: a.token, body: { name: 'Kitchen' } })).status, 409);
  });

  test('unlocking is audited', async () => {
    const result = await api('POST', '/api/devices/dev-lock/commands', { token: a.token, body: { capability: 'lock', action: 'unlock' } });
    assert.equal(result.status, 200);
    const { db } = await import('../src/ems/db.ts');
    const row = db().prepare('SELECT user_id, action, target FROM audit_log ORDER BY id DESC LIMIT 1').get() as Record<string, string>;
    assert.deepEqual({ ...row }, { user_id: a.user.id, action: 'lock.unlock', target: 'lock.front' });
  });

  test('a hub that goes down: hub_status pushed, reads keep the last state, commands refused', async () => {
    const session = await listen(b.token);
    homeB.dropAll(true);
    await until(async () => session.events, (events) => events.some((event) => event.type === 'hub_status' && event.status === 'offline'));
    const devices = await api<DeviceShape[]>('GET', '/api/devices', { token: b.token });
    assert.equal(devices.status, 200);
    const command = await api('POST', '/api/devices/b_dev-plug/commands', { token: b.token, body: { capability: 'power', action: 'on' } });
    assert.equal(command.status, 503);
    assert.equal(command.error?.code, 'hub_offline');
    // Unit A is unaffected.
    assert.equal((await api<{ hub: { status: string } }>('GET', '/api/home', { token: a.token })).data.hub.status, 'online');

    homeB.allowConnections();
    await until(async () => session.events, (events) => events.some((event) => event.type === 'hub_status' && event.status === 'online'), 8000);
    session.socket.close();
  });
});
