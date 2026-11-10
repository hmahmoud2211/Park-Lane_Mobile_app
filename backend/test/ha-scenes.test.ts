import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { demoHome, FakeHa } from './fakeHa.ts';

/**
 * Phase 6: scenes and automations the installer made in an apartment's Home Assistant: listed (hidden ones left
 * out), a scene activated, an automation switched off and run; nothing else can be called through them, and
 * another apartment can't reach them.
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
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-ha-scenes-')),
  ADMIN_API_KEY: ADMIN,
  HA_ALLOWED_NETWORKS: '127.0.0.0/8',
  HA_COMMAND_TIMEOUT_MS: '600',
});

const { createApp } = await import('../src/app.ts');
const { stopHubs } = await import('../src/ha/hubs.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

function withScenes(prefix = '') {
  const setup = demoHome(prefix);
  setup.entities.push(
    { entity_id: `scene.${prefix}movie_night`, device_id: null, name: 'Movie night', platform: 'homeassistant' },
    { entity_id: `scene.${prefix}secret`, device_id: null, hidden_by: 'user', platform: 'homeassistant' },
    { entity_id: `automation.${prefix}night_lights`, device_id: null, platform: 'automation' },
  );
  Object.assign(setup.states, {
    [`scene.${prefix}movie_night`]: { s: '2026-11-09T20:00:00+00:00', a: { friendly_name: 'Movie night', icon: 'mdi:movie' } },
    [`scene.${prefix}secret`]: { s: 'unknown', a: { friendly_name: 'Secret' } },
    [`automation.${prefix}night_lights`]: { s: 'on', a: { friendly_name: 'Night lights', last_triggered: '2026-11-09T22:00:00+00:00' } },
  });
  return setup;
}

const homeA = new FakeHa(withScenes(), 'token-for-home-a-0000');
const homeB = new FakeHa(withScenes('b_'), 'token-for-home-b-0000');
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


describe('Scenes and automations', () => {
  test('listed from the apartment\'s hub, without hidden ones and not as devices', async () => {
    const person = await unitWithHub('Tower S · 1', homeA, 'token-for-home-a-0000');
    const scenes = await api<{ id: string; name: string; icon: string | null; lastActivated: string | null }[]>('GET', '/api/home/scenes', { token: person.token });
    assert.deepEqual(scenes.data.map((scene) => [scene.id, scene.name, scene.icon]), [['scene.movie_night', 'Movie night', 'mdi:movie']]);
    assert.equal(scenes.data[0].lastActivated, '2026-11-09T20:00:00+00:00');
    const automations = await api<{ id: string; enabled: boolean }[]>('GET', '/api/home/automations', { token: person.token });
    assert.deepEqual(automations.data.map((entry) => [entry.id, entry.enabled]), [['automation.night_lights', true]]);
    const devices = await api<{ id: string }[]>('GET', '/api/devices', { token: person.token });
    assert.ok(!JSON.stringify(devices.data).includes('scene.') && !JSON.stringify(devices.data).includes('automation.'));

    assert.equal((await api('POST', '/api/home/scenes/scene.movie_night/activate', { token: person.token })).status, 200);
    assert.deepEqual(homeA.calls.at(-1), { domain: 'scene', service: 'turn_on', entityId: 'scene.movie_night', data: {} });
    assert.equal((await api('PATCH', '/api/home/automations/automation.night_lights', { token: person.token, body: { action: 'disable' } })).status, 200);
    assert.deepEqual(homeA.calls.at(-1), { domain: 'automation', service: 'turn_off', entityId: 'automation.night_lights', data: {} });
    assert.equal((await api('PATCH', '/api/home/automations/automation.night_lights', { token: person.token, body: { action: 'run' } })).status, 200);
    assert.equal(homeA.calls.at(-1)?.service, 'trigger');
  });

  test('only scenes and automations, only visible ones, only the apartment\'s own', async () => {
    const person = await unitWithHub('Tower S · 2', homeB, 'token-for-home-b-0000');
    const before = homeB.calls.length;
    for (const path of ['/api/home/scenes/lock.b_front/activate', '/api/home/scenes/scene.b_secret/activate', '/api/home/scenes/scene.movie_night/activate']) {
      assert.equal((await api('POST', path, { token: person.token })).status, 404, path);
    }
    assert.equal((await api('PATCH', '/api/home/automations/scene.b_movie_night', { token: person.token, body: { action: 'run' } })).status, 404);
    assert.equal((await api('PATCH', '/api/home/automations/automation.b_night_lights', { token: person.token, body: { action: 'delete' } })).status, 422);
    assert.equal(homeB.calls.length, before, 'nothing reached the hub');
  });
});
