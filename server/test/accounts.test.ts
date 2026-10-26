import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { demoHome, FakeHa } from './fakeHa.ts';

/**
 * Linking brand accounts end to end: the residents' account API against a
 * stand-in Home Assistant running scripted config flows (a form, a QR code
 * and an OAuth sign-in), plus listing, reconnecting and removing accounts.
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
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-accounts-')),
  ADMIN_API_KEY: ADMIN,
  HA_ALLOWED_NETWORKS: '127.0.0.0/8',
  PUBLIC_URL: 'https://api-iot.example.com',
  APP_RETURN_URL: 'parklane://accounts',
  HA_OAUTH_CREDENTIALS: JSON.stringify({ smartthings: { clientId: 'st', clientSecret: 'secret' } }),
});

const { createApp } = await import('../src/app.ts');
const { stopHubs } = await import('../src/ha/hubs.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

const ha = new FakeHa(demoHome(), 'token-for-accounts-0000');
let server: Server;

before(async () => {
  await ha.listen();
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});

after(async () => {
  stopHubs();
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await ha.close();
});

beforeEach(() => resetLimits());

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
async function resident(unitId?: string) {
  counter += 1;
  const email = `linker${counter}@example.com`;
  const result = await api<{ token: string }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery' } });
  if (unitId) await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email } });
  return result.data.token;
}

interface Field {
  name: string;
  kind: string;
  label: string;
  required: boolean;
  data: string | null;
}

interface Step {
  flowId: string;
  type: string;
  title: string | null;
  description: string | null;
  fields: Field[];
  errors: Record<string, string>;
  url: string | null;
  accountId: string | null;
  message: string | null;
}

let token = '';
let unitId = '';

describe('linking brand accounts', () => {
  before(async () => {
    const unit = await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name: 'Tower D · 0202', provision: false } });
    unitId = unit.data.id;
    token = await resident(unitId);
    await api('POST', '/api/admin/hubs', { token: ADMIN, body: { unitId, baseUrl: `http://127.0.0.1:${ha.port}`, token: 'token-for-accounts-0000' } });
    await until(() => api<{ hub: { status: string } }>('GET', '/api/home', { token }), (home) => home.data?.hub?.status === 'online');
  });

  test('lists the curated brands; OAuth ones only when the company has an app with them', async () => {
    const list = await api<{ id: string; method: string; available: boolean }[]>('GET', '/api/accounts/integrations', { token });
    const byId = new Map(list.data.map((entry) => [entry.id, entry]));
    assert.equal(byId.get('tuya')?.method, 'qr');
    assert.equal(byId.get('smartthings')?.available, true);
    assert.equal(byId.get('nest')?.available, false);
    assert.ok(!byId.has('shelly'), 'local-only integrations are not offered');
  });

  test('refuses brands outside the list and OAuth brands that are not set up', async () => {
    assert.equal((await api('POST', '/api/accounts/flows', { token, body: { integration: 'mqtt' } })).status, 400);
    const nest = await api('POST', '/api/accounts/flows', { token, body: { integration: 'nest' } });
    assert.equal(nest.status, 409);
    assert.equal(nest.error?.code, 'not_available');
  });

  test('a credentials form: labelled fields, the brand’s error, then a linked account', async () => {
    const start = await api<Step>('POST', '/api/accounts/flows', { token, body: { integration: 'switchbot_cloud' } });
    assert.equal(start.status, 200, JSON.stringify(start.error));
    assert.equal(start.data.type, 'form');
    assert.equal(start.data.title, 'Connect SwitchBot');
    assert.deepEqual(
      start.data.fields.map((field) => [field.name, field.kind, field.label, field.required]),
      [
        ['api_token', 'string', 'Token', true],
        ['api_key', 'password', 'Secret', true],
      ],
    );

    const malformed = await api('POST', `/api/accounts/flows/${start.data.flowId}`, { token, body: { data: { api_key: 'x' } } });
    assert.equal(malformed.status, 400, 'HA refusing the input is the resident’s to fix, not a hub failure');
    assert.match(malformed.error?.message ?? '', /api_token/);

    const wrong = await api<Step>('POST', `/api/accounts/flows/${start.data.flowId}`, { token, body: { data: { api_token: 'bad', api_key: 'x' } } });
    assert.equal(wrong.data.type, 'form');
    assert.deepEqual(wrong.data.errors, { base: 'Invalid authentication' });

    const done = await api<Step>('POST', `/api/accounts/flows/${start.data.flowId}`, { token, body: { data: { api_token: 'good', api_key: 'x' } } });
    assert.equal(done.data.type, 'done');
    assert.ok(done.data.accountId);

    const accounts = await until(
      () => api<{ id: string; brand: string; needsReconnect: boolean }[]>('GET', '/api/accounts', { token }),
      (list) => list.data.some((account) => account.id === done.data.accountId),
    );
    assert.equal(accounts.data.find((account) => account.id === done.data.accountId)?.brand, 'SwitchBot');

    // The account's devices join the home, controllable like any other.
    const devices = await until(
      () => api<{ id: string; name: string; accountId: string | null; kind: string }[]>('GET', '/api/devices', { token }),
      (list) => list.data.some((device) => device.accountId === done.data.accountId),
    );
    const added = devices.data.find((device) => device.accountId === done.data.accountId);
    assert.deepEqual([added?.name, added?.kind], ['SwitchBot Plug', 'plug']);
    const switched = await api<{ capabilities: { type: string; value: string }[] }>('POST', `/api/devices/${added?.id}/commands`, {
      token,
      body: { capability: 'power', action: 'on' },
    });
    assert.equal(switched.data.capabilities[0].value, 'on');
    const linked = await until(
      () => api<{ id: string; deviceCount: number }[]>('GET', '/api/accounts', { token }),
      (list) => list.data.find((account) => account.id === done.data.accountId)?.deviceCount === 1,
    );
    assert.ok(linked);
  });

  test('another resident cannot drive someone else’s flow', async () => {
    const start = await api<Step>('POST', '/api/accounts/flows', { token, body: { integration: 'switchbot_cloud' } });
    const other = await resident(unitId);
    const hijack = await api('POST', `/api/accounts/flows/${start.data.flowId}`, { token: other, body: { data: { api_token: 'good', api_key: 'x' } } });
    assert.equal(hijack.status, 410);
    assert.equal((await api('DELETE', `/api/accounts/flows/${start.data.flowId}`, { token })).status, 200);
    assert.ok(!ha.flows.has(start.data.flowId));
  });

  test('a QR step carries the code to show, with its placeholders filled', async () => {
    const start = await api<Step>('POST', '/api/accounts/flows', { token, body: { integration: 'tuya' } });
    const scan = await api<Step>('POST', `/api/accounts/flows/${start.data.flowId}`, { token, body: { data: { user_code: 'abc' } } });
    assert.equal(scan.data.description, 'Scan this code with the Smart Life app.');
    assert.deepEqual(
      scan.data.fields.map((field) => [field.kind, field.data]),
      [['qr', 'tuyaSmart--qrLogin?token=abc123']],
    );
    const done = await api<Step>('POST', `/api/accounts/flows/${start.data.flowId}`, { token, body: { data: {} } });
    assert.equal(done.data.type, 'done');
  });

  test('OAuth: the brand returns to one fixed address, which reaches the right hub and goes back to the app', async () => {
    const start = await api<Step>('POST', '/api/accounts/flows', { token, body: { integration: 'smartthings' } });
    assert.equal(start.data.type, 'external');
    assert.equal(ha.lastFrontendBase, 'https://api-iot.example.com/api/accounts/oauth');
    const authorize = new URL(start.data.url as string);
    assert.equal(authorize.searchParams.get('redirect_uri'), 'https://api-iot.example.com/api/accounts/oauth/auth/external/callback');

    // The brand redirects the browser to the backend's callback.
    const callback = await fetch(`${BASE}/api/accounts/oauth/auth/external/callback?code=xyz&state=${authorize.searchParams.get('state')}`, {
      redirect: 'manual',
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), `parklane://accounts?result=ok&flow=${start.data.flowId}`);

    // Back in the app: the external step is done, so the flow finishes.
    const done = await api<Step>('GET', `/api/accounts/flows/${start.data.flowId}`, { token });
    assert.equal(done.data.type, 'done');
  });

  test('a callback with a forged or stale state goes back to the app as expired', async () => {
    const forged = await fetch(`${BASE}/api/accounts/oauth/auth/external/callback?code=xyz&state=not.a.jwt`, { redirect: 'manual' });
    assert.equal(forged.headers.get('location'), 'parklane://accounts?result=expired');
  });

  test('an account that needs signing in again: reconnect continues the brand’s flow', async () => {
    const entry = ha.addEntry('tuya', 'Old Smart Life', 'setup_error');
    const flowId = ha.startReauth(entry);
    const accounts = await api<{ id: string; needsReconnect: boolean }[]>('GET', '/api/accounts', { token });
    assert.equal(accounts.data.find((account) => account.id === entry.entry_id)?.needsReconnect, true);
    const step = await api<{ step: Step }>('POST', `/api/accounts/${entry.entry_id}/reconnect`, { token });
    assert.equal(step.data.step.flowId, flowId);
    const finished = await api<Step>('POST', `/api/accounts/flows/${flowId}`, { token, body: { data: {} } });
    assert.equal(finished.data.type, 'abort');
  });

  test('reload and remove an account; others’ accounts are not found', async () => {
    const entry = ha.addEntry('switchbot_cloud', 'Spare SwitchBot');
    assert.equal((await api('POST', `/api/accounts/${entry.entry_id}/reload`, { token })).status, 200);
    assert.equal((await api('DELETE', `/api/accounts/${entry.entry_id}`, { token })).status, 200);
    assert.ok(!ha.entries.some((candidate) => candidate.entry_id === entry.entry_id));
    assert.equal((await api('DELETE', '/api/accounts/entry-not-here', { token })).status, 404);
  });

  test('residents without a unit cannot link anything', async () => {
    const loner = await resident();
    assert.equal((await api('POST', '/api/accounts/flows', { token: loner, body: { integration: 'tuya' } })).status, 404);
    assert.equal((await api('GET', '/api/accounts', { token: loner })).status, 404);
  });
});
