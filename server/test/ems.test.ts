import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/** End to end over HTTP and WebSocket: EMS accounts, sessions and the realtime channel. */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;

// config.ts reads these once, on first import.
Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-backend-')),
  BACKEND_API_KEY: 'ops-key',
});

const { createApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

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
  // Let fetch's connection pool see its keep-alive sockets close before the next request.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

before(startApp);
after(stopApp);
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
  const deadline = Date.now() + 2000;
  while (!events.some((event) => event.type === 'ready' || event.type === 'error')) {
    if (Date.now() > deadline || closeCode) {
      throw new Error(`no ready or error event (close ${closeCode}): ${JSON.stringify(events)}`);
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
      setTimeout(resolve, 50);
    });
  }
  return { socket, events, closed: () => closeCode };
}

// ---- Tests -------------------------------------------------------------------------------

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

describe('operations', () => {
  test('health needs the API key', async () => {
    assert.equal((await api('GET', '/api/health')).status, 401);
    assert.equal((await api('GET', '/api/health', { token: 'ops-key' })).status, 200);
  });

  test('removed CUBE, SONOFF and Alexa routes are gone', async () => {
    const { token } = await newUser();
    for (const path of ['/api/cube/devices', '/api/sonoff/discover', '/api/integrations/alexa/status']) {
      assert.equal((await api('GET', path, { token: 'ops-key' })).status, 404, path);
      assert.equal((await api('GET', path, { token })).status, 404, path);
    }
  });
});

describe('persistence and reconnection', () => {
  test('sessions survive a restart, and a reconnected session is ready again', async () => {
    const { token, user } = await newUser();
    const first = await listen(token);
    assert.equal(first.events[0].type, 'ready');

    await stopApp();
    closeDb();
    await startApp();

    const me = await api<{ user: { id: string } }>('GET', '/api/auth/me', { token });
    assert.equal(me.data.user.id, user.id);
    first.socket.close();

    const second = await listen(token);
    assert.equal(second.events[0].type, 'ready');
    second.socket.close();
  });

  test('a session with a bad token is refused', async () => {
    const session = await listen('not-a-token');
    assert.equal(session.events[0].type, 'error');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(session.closed(), 4401);
  });
});
