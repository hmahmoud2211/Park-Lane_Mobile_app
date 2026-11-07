import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * Building management: the first admin account, the admin dashboard's API with admin sign-ins, accounts made
 * with temporary passwords that must be replaced before anything else works, and the dashboard's page itself.
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
const ADMIN = 'admin-key-for-admin-tests';
const SECRET = 'a'.repeat(64);

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-admin-')),
  ADMIN_API_KEY: ADMIN,
  EMS_ADMIN_USERNAME: 'boss',
  EMS_ADMIN_PASSWORD: 'first-password-123',
});

const { createApp } = await import('../src/app.ts');
const { ensureAdminAccount } = await import('../src/ems/auth.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

let server: Server;

before(async () => {
  await ensureAdminAccount();
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});

after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
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

async function resident(email: string): Promise<{ token: string; id: string }> {
  const result = await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery' } });
  return { token: result.data.token, id: result.data.user.id };
}

async function unit(name: string): Promise<string> {
  return (await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false } })).data.id;
}

async function login(email: string, password: string) {
  return api<{ token: string; user: { role: string; mustChangePassword?: boolean } }>('POST', '/api/auth/login', { body: { email, password } });
}

async function adminSession(): Promise<string> {
  const first = await login('boss', 'first-password-123');
  if (first.status !== 200) {
    return (await login('boss', 'boss-own-password-1')).data.token; // already changed by an earlier test
  }
  await api('POST', '/api/auth/change-password', { token: first.data.token, body: { currentPassword: 'first-password-123', newPassword: 'boss-own-password-1' } });
  return first.data.token;
}

describe('building management', () => {
  test('the first admin must choose its own password before managing anything', async () => {
    const signedIn = await login('boss', 'first-password-123');
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.data.user.role, 'admin');
    assert.equal(signedIn.data.user.mustChangePassword, true);
    const token = signedIn.data.token;
    assert.equal((await api('GET', '/api/admin/units', { token })).error?.code, 'password_change_required');
    assert.equal((await api('GET', '/api/home', { token })).error?.code, 'password_change_required');
    assert.equal((await api<{ user: { mustChangePassword?: boolean } }>('GET', '/api/auth/me', { token })).data.user.mustChangePassword, true);
    // The rules.
    for (const [currentPassword, newPassword, status] of [
      ['wrong-password-0', 'boss-own-password-1', 401],
      ['first-password-123', 'short', 400],
      ['first-password-123', 'first-password-123', 400],
      ['first-password-123', 'boss', 400],
    ] as const) {
      assert.equal((await api('POST', '/api/auth/change-password', { token, body: { currentPassword, newPassword } })).status, status, newPassword);
    }
    const changed = await api<{ user: { mustChangePassword?: boolean } }>('POST', '/api/auth/change-password', {
      token,
      body: { currentPassword: 'first-password-123', newPassword: 'boss-own-password-1' },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.mustChangePassword, undefined);
    assert.equal((await api('GET', '/api/admin/units', { token })).status, 200, 'the same session now works');
    assert.equal((await login('boss', 'first-password-123')).status, 401);
    await ensureAdminAccount();
    assert.equal((await login('boss', 'boss-own-password-1')).status, 200, 'a second start changes nothing');
  });

  test('an admin creates a resident with a temporary password, in an apartment', async () => {
    const admin = await adminSession();
    const unitId = (await api<{ id: string }>('POST', '/api/admin/units', { token: admin, body: { name: 'Tower A · 1203', provision: false } })).data.id;
    const created = await api<{ user: { id: string; role: string; mustChangePassword: boolean }; temporaryPassword: string; unitId: string }>('POST', '/api/admin/users', {
      token: admin,
      body: { email: 'Owner-1203@Parklane.test', name: 'Hazem', role: 'resident', unitId, unitRole: 'owner' },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.user.role, 'resident');
    assert.equal(created.data.unitId, unitId);
    assert.match(created.data.temporaryPassword, /^[A-HJ-NP-Za-km-np-z2-9]{14}$/);
    assert.equal((await api('POST', '/api/admin/users', { token: admin, body: { email: 'owner-1203@parklane.test' } })).status, 409);

    const owner = await login('owner-1203@parklane.test', created.data.temporaryPassword);
    assert.equal(owner.data.user.mustChangePassword, true);
    for (const [method, path] of [['GET', '/api/home'], ['GET', '/api/unit'], ['POST', '/api/gateway/pass'], ['POST', '/api/unit/invites']] as const) {
      assert.equal((await api(method, path, { token: owner.data.token, body: method === 'POST' ? {} : undefined })).error?.code, 'password_change_required', path);
    }
    await api('POST', '/api/auth/change-password', { token: owner.data.token, body: { currentPassword: created.data.temporaryPassword, newPassword: 'hazem-own-password' } });
    const unit = await api<{ role: string; unit: { id: string } }>('GET', '/api/unit', { token: owner.data.token });
    assert.equal(unit.data.unit.id, unitId);
    assert.equal(unit.data.role, 'owner');

    const detail = await api<{ name: string; members: { email: string; role: string }[]; gateway: null; hub: null }>('GET', `/api/admin/units/${unitId}`, { token: admin });
    assert.equal(detail.data.name, 'Tower A · 1203');
    assert.deepEqual(detail.data.members.map((m) => [m.email, m.role]), [['owner-1203@parklane.test', 'owner']]);
    assert.equal(detail.data.gateway, null);

    const found = await api<{ email: string; unit: { name: string; role: string } | null; mustChangePassword: boolean }[]>('GET', '/api/admin/users?q=owner-1203', { token: admin });
    assert.deepEqual(found.data.map((u) => [u.email, u.unit?.name, u.unit?.role, u.mustChangePassword]), [['owner-1203@parklane.test', 'Tower A · 1203', 'owner', false]]);
  });

  test('a password reset signs the person out everywhere and gives a new temporary password', async () => {
    const admin = await adminSession();
    const created = await api<{ user: { id: string }; temporaryPassword: string }>('POST', '/api/admin/users', { token: admin, body: { email: 'reset-me@parklane.test' } });
    const first = await login('reset-me@parklane.test', created.data.temporaryPassword);
    await api('POST', '/api/auth/change-password', { token: first.data.token, body: { currentPassword: created.data.temporaryPassword, newPassword: 'my-own-password-1' } });
    assert.equal((await api('GET', '/api/auth/me', { token: first.data.token })).status, 200);
    const reset = await api<{ temporaryPassword: string }>('POST', `/api/admin/users/${created.data.user.id}/reset-password`, { token: admin });
    assert.equal((await api('GET', '/api/auth/me', { token: first.data.token })).status, 401, 'signed out');
    assert.equal((await login('reset-me@parklane.test', 'my-own-password-1')).status, 401);
    const again = await login('reset-me@parklane.test', reset.data.temporaryPassword);
    assert.equal(again.data.user.mustChangePassword, true);
    assert.equal((await api('POST', '/api/admin/users/nobody/reset-password', { token: admin })).status, 404);
  });

  test('admins create admins; residents never reach the admin API; the shared key still does', async () => {
    const admin = await adminSession();
    const created = await api<{ temporaryPassword: string }>('POST', '/api/admin/users', { token: admin, body: { email: 'deputy@parklane.test', role: 'admin', unitId: '' } });
    const deputy = await login('deputy@parklane.test', created.data.temporaryPassword);
    assert.equal(deputy.data.user.role, 'admin');
    assert.equal((await api('GET', '/api/admin/users', { token: deputy.data.token })).error?.code, 'password_change_required');
    await api('POST', '/api/auth/change-password', { token: deputy.data.token, body: { currentPassword: created.data.temporaryPassword, newPassword: 'deputy-own-password' } });
    assert.equal((await api('GET', '/api/admin/users', { token: deputy.data.token })).status, 200);

    const plain = await resident('plain-resident@parklane.test');
    assert.equal((await api('GET', '/api/admin/units', { token: plain.token })).status, 403);
    assert.equal((await api('POST', '/api/admin/users', { token: plain.token, body: { email: 'x@parklane.test', role: 'admin' } })).status, 403);
    assert.equal((await api('GET', '/api/admin/units', { token: ADMIN })).status, 200);
    assert.equal((await api('GET', '/api/admin/units')).status, 401);
  });

  test('the dashboard page is served with headers that keep it to this backend', async () => {
    const page = await fetch(`${BASE}/admin`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const csp = page.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(await page.text(), /<script src="\/admin\/app\.js"/);
    const script = await fetch(`${BASE}/admin/app.js`);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert.equal((await fetch(`${BASE}/admin/app.css`)).status, 200);
    assert.equal((await fetch(`${BASE}/admin/secrets.txt`)).status, 404);
    assert.equal((await fetch(`${BASE}/admin`, { method: 'POST' })).status, 404);
  });
});
