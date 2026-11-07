import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * Apartments and who shares them: owner invite codes, joining with one, member lists and removal, and that a
 * removed member loses the apartment's brand-account devices and its CUBE gateway pass.
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
const ADMIN = 'admin-key-for-unit-tests';
const SECRET = 'a'.repeat(64);

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-units-')), ADMIN_API_KEY: ADMIN });

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

interface Unit {
  unit: { id: string; name: string };
  role: string;
  members: { userId: string; name: string; email: string | null; role: string; you: boolean }[];
}

async function owned(name: string, ownerEmail: string): Promise<{ unitId: string; owner: { token: string; id: string } }> {
  const unitId = await unit(name);
  const owner = await resident(ownerEmail);
  await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: ownerEmail, role: 'owner' } });
  return { unitId, owner };
}

describe('apartments and family invites', () => {
  test('an owner invites family, who join with their own account and see the apartment', async () => {
    const { unitId, owner } = await owned('Tower A · 1203', 'owner@units.test');
    const family = await resident('family@units.test');
    assert.equal((await api('GET', '/api/unit', { token: family.token })).error?.code, 'no_home');

    const invite = await api<{ code: string; role: string; expiresAt: number }>('POST', '/api/unit/invites', { token: owner.token, body: {} });
    assert.equal(invite.status, 200);
    assert.match(invite.data.code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(invite.data.role, 'member');
    assert.ok(invite.data.expiresAt > Date.now() + 23 * 3600_000);

    // Typed loosely: lower case, spaces instead of the dash.
    const typed = invite.data.code.toLowerCase().replace('-', ' ');
    const joined = await api<Unit>('POST', '/api/unit/join', { token: family.token, body: { code: ` ${typed} ` } });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.unit.id, unitId);
    assert.equal(joined.data.role, 'member');
    assert.deepEqual(joined.data.members.map((m) => [m.userId, m.role, m.you, m.email]), [
      [owner.id, 'owner', false, null], // members don't see emails
      [family.id, 'member', true, null],
    ]);
    const ownerView = await api<Unit>('GET', '/api/unit', { token: owner.token });
    assert.deepEqual(ownerView.data.members.map((m) => m.email), ['owner@units.test', 'family@units.test']);

    // Used once: nobody else gets in with it.
    const stranger = await resident('stranger@units.test');
    const reused = await api('POST', '/api/unit/join', { token: stranger.token, body: { code: invite.data.code } });
    assert.equal(reused.status, 422);
    assert.equal(reused.error?.code, 'invalid');
    assert.equal((await api('POST', '/api/unit/join', { token: stranger.token, body: { code: 'AAAA-BBBB' } })).status, 422);
  });

  test('only owners invite and remove, and an owner invite makes an owner', async () => {
    const { owner } = await owned('Tower B · 0101', 'owner-b@units.test');
    const asOwner = await api<{ code: string }>('POST', '/api/unit/invites', { token: owner.token, body: { role: 'owner' } });
    const partner = await resident('partner-b@units.test');
    assert.equal((await api<Unit>('POST', '/api/unit/join', { token: partner.token, body: { code: asOwner.data.code } })).data.role, 'owner');
    const member = await resident('member-b@units.test');
    const code = (await api<{ code: string }>('POST', '/api/unit/invites', { token: partner.token, body: {} })).data.code;
    await api('POST', '/api/unit/join', { token: member.token, body: { code } });
    assert.equal((await api('POST', '/api/unit/invites', { token: member.token, body: {} })).status, 403);
    assert.equal((await api('DELETE', `/api/unit/members/${owner.id}`, { token: member.token })).status, 403);
    assert.equal((await api('DELETE', `/api/unit/members/${owner.id}`, { token: owner.token })).status, 400, 'not yourself');
    const nobody = await resident('nobody-b@units.test');
    assert.equal((await api('DELETE', `/api/unit/members/${nobody.id}`, { token: owner.token })).status, 404);
    assert.equal((await api('POST', '/api/unit/invites', { token: nobody.token, body: {} })).error?.code, 'no_home');
    const assistant = await api<{ token: string }>('POST', '/api/auth/assistant-token', { token: owner.token });
    assert.equal((await api('GET', '/api/unit', { token: assistant.data.token })).status, 401);
  });

  test('joining a second apartment is refused; a code for your own stays usable', async () => {
    const first = await owned('Tower C · 0303', 'owner-c@units.test');
    const second = await owned('Tower C · 0404', 'owner-d@units.test');
    const ownCode = (await api<{ code: string }>('POST', '/api/unit/invites', { token: first.owner.token, body: {} })).data.code;
    const otherCode = (await api<{ code: string }>('POST', '/api/unit/invites', { token: second.owner.token, body: {} })).data.code;
    const conflict = await api('POST', '/api/unit/join', { token: first.owner.token, body: { code: otherCode } });
    assert.equal(conflict.status, 409);
    assert.equal((await api<Unit>('POST', '/api/unit/join', { token: first.owner.token, body: { code: ownCode } })).data.unit.id, first.unitId);
    const newcomer = await resident('newcomer-c@units.test');
    assert.equal((await api('POST', '/api/unit/join', { token: newcomer.token, body: { code: ownCode } })).status, 200, 'still unused');
  });

  test('a removed member loses the apartment and its gateway', async () => {
    const { unitId, owner } = await owned('Tower D · 0505', 'owner-e@units.test');
    const gatewayId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId, secret: SECRET } });
    const family = await resident('family-e@units.test');
    const code = (await api<{ code: string }>('POST', '/api/unit/invites', { token: owner.token, body: {} })).data.code;
    await api('POST', '/api/unit/join', { token: family.token, body: { code } });
    assert.equal((await api('POST', '/api/gateway/pass', { token: family.token })).status, 200);
    const members = async () =>
      (await api<{ members: { userId: string }[] }>('GET', '/api/gateway/members', { token: `${gatewayId}.${SECRET}` })).data.members.map((m) => m.userId);
    assert.deepEqual((await members()).sort(), [owner.id, family.id].sort());

    const after = await api<Unit>('DELETE', `/api/unit/members/${family.id}`, { token: owner.token });
    assert.deepEqual(after.data.members.map((m) => m.userId), [owner.id]);
    assert.equal((await api('GET', '/api/unit', { token: family.token })).error?.code, 'no_home');
    assert.equal((await api('POST', '/api/gateway/pass', { token: family.token })).error?.code, 'no_gateway');
    assert.deepEqual(await members(), [owner.id], 'the gateway drops their phones at its next check');
  });

  test('building management can take a resident out, and guessing codes is limited', async () => {
    const { unitId, owner } = await owned('Tower F · 0606', 'owner-f@units.test');
    assert.deepEqual((await api('DELETE', `/api/admin/units/${unitId}/members/${owner.id}`, { token: ADMIN })).data, { removed: true });
    assert.equal((await api('GET', '/api/unit', { token: owner.token })).error?.code, 'no_home');
    const guesser = await resident('guesser@units.test');
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await api('POST', '/api/unit/join', { token: guesser.token, body: { code: `AAAA-AAA${'23456789AB'[i]}` } })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(422));
    assert.equal(statuses[10], 429);
  });
});
