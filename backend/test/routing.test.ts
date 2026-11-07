import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * Pins how requests are routed, independent of what each route does: the
 * order of the auth and method checks, 404 instead of 405, CORS on every
 * answer, and what the access log may print. The router can be restructured
 * freely as long as these hold.
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

// config.ts reads these once, on first import.
Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-routing-')),
  ADMIN_API_KEY: 'ops-key',
});

const { createApp } = await import('../src/app.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

let server: Server;

before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});
after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => resetLimits());

interface Answer {
  status: number;
  headers: Headers;
  text: string;
  body: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } | null;
}

async function call(method: string, path: string, options: { token?: string; body?: string } = {}): Promise<Answer> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body,
    redirect: 'manual',
  });
  const text = await response.text();
  let body: Answer['body'] = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, text, body };
}

let counter = 0;
async function newSession(): Promise<string> {
  counter += 1;
  const { body } = await call('POST', '/api/auth/register', {
    body: JSON.stringify({ email: `routing${counter}@example.com`, password: 'correct horse battery', name: 'Routing' }),
  });
  return String(body?.data?.token);
}

async function assistantTokenFor(session: string): Promise<string> {
  const { body } = await call('POST', '/api/auth/assistant-token', { token: session });
  return String(body?.data?.token);
}

function assertCors(answer: Answer) {
  assert.equal(answer.headers.get('access-control-allow-origin'), '*');
  assert.equal(answer.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
  assert.equal(answer.headers.get('access-control-allow-methods'), 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function assertError(answer: Answer, status: number, code: string) {
  assert.equal(answer.status, status, `${status} expected, got ${answer.status}: ${answer.text}`);
  assert.equal(answer.body?.ok, false);
  assert.equal(answer.body?.error?.code, code);
  assert.equal(typeof answer.body?.error?.message, 'string');
}

describe('preflight and envelopes', () => {
  test('OPTIONS answers 204 with CORS headers and no body, on any path', async () => {
    for (const path of ['/api/home', '/api/nothing-here', '/not-api']) {
      const answer = await call('OPTIONS', path);
      assert.equal(answer.status, 204);
      assert.equal(answer.text, '');
      assertCors(answer);
    }
  });

  test('an unknown path is a 404 envelope with CORS and no-store headers', async () => {
    for (const path of ['/', '/nope', '/api/nope', '/api']) {
      const answer = await call('GET', path);
      assertError(answer, 404, 'not_found');
      assertCors(answer);
      assert.equal(answer.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(answer.headers.get('cache-control'), 'no-store');
    }
  });

  test('errors carry CORS headers too', async () => {
    const answer = await call('GET', '/api/home');
    assertError(answer, 401, 'unauthorized');
    assertCors(answer);
  });

  test('a body that is not a JSON object is a 400', async () => {
    assertError(await call('POST', '/api/auth/login', { body: '{' }), 400, 'bad_request');
    assertError(await call('POST', '/api/auth/login', { body: '[1]' }), 400, 'bad_request');
  });
});

describe('method mismatches fall through to 404, never 405', () => {
  test('a known path with the wrong method', async () => {
    assertError(await call('GET', '/api/auth/login'), 404, 'not_found');
    assertError(await call('PUT', '/api/auth/register'), 404, 'not_found');
    assertError(await call('POST', '/api/home'), 404, 'not_found');
    assertError(await call('DELETE', '/api/accounts/integrations'), 404, 'not_found');
  });

  test('auth runs before the method check on device paths', async () => {
    const session = await newSession();
    assertError(await call('DELETE', '/api/devices/x'), 401, 'unauthorized');
    assertError(await call('DELETE', '/api/devices/x', { token: session }), 404, 'not_found');
    assertError(await call('GET', '/api/devices/x/commands', { token: session }), 404, 'not_found');
  });

  test('a device id that is not valid percent-encoding is an internal error once signed in', async () => {
    const session = await newSession();
    assertError(await call('GET', '/api/devices/%E0%A4%A'), 401, 'unauthorized');
    assertError(await call('GET', '/api/devices/%E0%A4%A', { token: session }), 500, 'internal');
  });

  test('renaming a device needs the app session, not an assistant token', async () => {
    const session = await newSession();
    const assistant = await assistantTokenFor(session);
    assertError(await call('PATCH', '/api/devices/x', { token: assistant, body: '{}' }), 401, 'unauthorized');
  });
});

describe('the accounts paths', () => {
  test('flows, integrations and refresh are never read as an account id', async () => {
    assertError(await call('GET', '/api/accounts/flows'), 404, 'not_found');
    assertError(await call('DELETE', '/api/accounts/refresh'), 404, 'not_found');
    assertError(await call('POST', '/api/accounts/integrations/reload'), 404, 'not_found');
  });

  test('an account id needs a session, then the right method', async () => {
    const session = await newSession();
    assertError(await call('GET', '/api/accounts/abc'), 401, 'unauthorized');
    assertError(await call('GET', '/api/accounts/abc', { token: session }), 404, 'not_found');
    assertError(await call('GET', '/api/accounts/abc/reload', { token: session }), 404, 'not_found');
  });

  test('a flow id needs a session before its method is checked', async () => {
    const session = await newSession();
    assertError(await call('PUT', '/api/accounts/flows/abc'), 401, 'unauthorized');
    assertError(await call('PUT', '/api/accounts/flows/abc', { token: session }), 404, 'not_found');
  });
});

describe('rooms', () => {
  test('writing needs the app session; other methods are a 404 once signed in', async () => {
    const session = await newSession();
    const assistant = await assistantTokenFor(session);
    assertError(await call('PUT', '/api/rooms'), 401, 'unauthorized');
    assertError(await call('PUT', '/api/rooms', { token: assistant }), 401, 'unauthorized');
    assertError(await call('POST', '/api/rooms', { token: assistant, body: '{}' }), 401, 'unauthorized');
    assertError(await call('PUT', '/api/rooms', { token: session }), 404, 'not_found');
  });
});

describe('operations and admin', () => {
  test('health needs the key once one is set', async () => {
    assertError(await call('GET', '/api/health'), 401, 'unauthorized');
    const answer = await call('GET', '/api/health', { token: 'ops-key' });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { ok: true, data: { status: 'ok' } });
    assertError(await call('POST', '/api/health', { token: 'ops-key' }), 404, 'not_found');
  });

  test('every /api/admin/ path checks the key before matching', async () => {
    assertError(await call('GET', '/api/admin/nothing'), 401, 'unauthorized');
    assertError(await call('GET', '/api/admin/nothing', { token: 'wrong' }), 401, 'unauthorized');
    assertError(await call('GET', '/api/admin/nothing', { token: 'ops-key' }), 404, 'not_found');
    assertError(await call('PUT', '/api/admin/units', { token: 'ops-key' }), 404, 'not_found');
  });

  test('a resident\'s session is not an admin', async () => {
    const session = await newSession();
    assertError(await call('GET', '/api/admin/units', { token: session }), 403, 'forbidden');
    assertError(await call('GET', '/api/admin/units', { token: 'not-a-token' }), 401, 'unauthorized');
  });
});

describe('the access log', () => {
  test('prints method, path, status and time, never the query string', async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...parts: unknown[]) => {
      lines.push(parts.map(String).join(' '));
    };
    try {
      await call('GET', '/api/home?token=very-secret-value');
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      console.log = original;
    }
    const line = lines.find((entry) => entry.includes('GET /api/home'));
    assert.ok(line, `no access line in ${JSON.stringify(lines)}`);
    assert.match(line, /INFO GET \/api\/home 401 \d+ms$/);
    assert.ok(!lines.some((entry) => entry.includes('very-secret-value')));
  });
});
