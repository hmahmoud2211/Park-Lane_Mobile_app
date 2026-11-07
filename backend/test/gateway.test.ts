import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * CUBE gateway access through EMS accounts: attaching a gateway to a unit, passes for its residents (signed,
 * short-lived, for that gateway only, carrying the resident's role), and the members list the gateway syncs.
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
const ADMIN = 'admin-key-for-gateway-tests';
const GW = '0810268a-65a9-4059-a543-0e1daaa8ab51';
const SECRET = 'a'.repeat(64);

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-gateway-')), ADMIN_API_KEY: ADMIN });

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

interface Pass {
  gateway: { id: string; url: string | null };
  pass: string;
  expiresAt: number;
  role: string;
}

function openPass(pass: string, publicKey: string): Record<string, unknown> {
  const [body, signature] = pass.split('.');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(body), key, Buffer.from(signature, 'base64url')), 'signature');
  return JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
}

describe('gateway access through EMS accounts', () => {
  test('an owner and a member get signed passes for their apartment gateway only', async () => {
    const unitId = await unit('Tower A · 1203');
    const owner = await resident('owner-1203@parklane.test');
    const member = await resident('family-1203@parklane.test');
    await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: 'owner-1203@parklane.test', role: 'owner' } });
    await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: 'family-1203@parklane.test', role: 'member' } });

    assert.equal((await api('POST', '/api/gateway/pass', { token: owner.token })).error?.code, 'no_gateway');
    const attached = await api('POST', '/api/admin/gateways', {
      token: ADMIN,
      body: { unitId, gatewayId: GW.toUpperCase(), secret: SECRET, url: `https://cube-relay.example.com/relay/v1/g/${GW}/` },
    });
    assert.equal(attached.status, 200);
    assert.deepEqual(attached.data, { id: GW, unitId, url: `https://cube-relay.example.com/relay/v1/g/${GW}` });

    const key = (await api<{ alg: string; key: string }>('GET', '/api/gateway/key')).data;
    assert.equal(key.alg, 'Ed25519');
    const before = Date.now();
    const issued = await api<Pass>('POST', '/api/gateway/pass', { token: owner.token });
    assert.equal(issued.status, 200);
    assert.deepEqual(issued.data.gateway, { id: GW, url: `https://cube-relay.example.com/relay/v1/g/${GW}` });
    assert.equal(issued.data.role, 'owner');
    assert.ok(issued.data.expiresAt > before && issued.data.expiresAt <= before + 5 * 60_000 + 1000);
    const claims = openPass(issued.data.pass, key.key);
    assert.equal(claims.v, 1);
    assert.equal(claims.sub, owner.id);
    assert.equal(claims.gw, GW);
    assert.equal(claims.unit, unitId);
    assert.equal(claims.role, 'owner');
    assert.equal(Number(claims.exp) - Number(claims.iat), 300);
    const again = await api<Pass>('POST', '/api/gateway/pass', { token: owner.token });
    assert.notEqual(openPass(again.data.pass, key.key).jti, claims.jti, 'each pass is single use');

    const family = await api<Pass>('POST', '/api/gateway/pass', { token: member.token });
    assert.equal(family.data.role, 'member');
    assert.equal(openPass(family.data.pass, key.key).role, 'member');
    // A changed pass no longer verifies.
    const [body, signature] = family.data.pass.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), role: 'owner' })).toString('base64url');
    assert.throws(() => openPass(`${forged}.${signature}`, key.key));
  });

  test('only the app session gets a pass, and someone without an apartment gets none', async () => {
    const owner = await resident('owner-assistant@parklane.test');
    const unitId = await unit('Tower B · 0101');
    await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: 'owner-assistant@parklane.test' } });
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId: '11111111-2222-4333-8444-555555555555', secret: SECRET } });
    const assistant = await api<{ token: string }>('POST', '/api/auth/assistant-token', { token: owner.token });
    assert.equal((await api('POST', '/api/gateway/pass', { token: assistant.data.token })).status, 401);
    assert.equal((await api('POST', '/api/gateway/pass')).status, 401);
    const nobody = await resident('no-unit@parklane.test');
    const none = await api('POST', '/api/gateway/pass', { token: nobody.token });
    assert.equal(none.status, 404);
    assert.equal(none.error?.code, 'no_gateway');
    // A gateway attached without a relay address: the pass says so.
    assert.equal((await api<Pass>('POST', '/api/gateway/pass', { token: owner.token })).data.gateway.url, null);
  });

  test('the gateway syncs its members with its secret, and sees residents leave', async () => {
    const unitId = await unit('Tower C · 0707');
    const leaving = await resident('leaving@parklane.test');
    const staying = await resident('staying@parklane.test');
    for (const email of ['leaving@parklane.test', 'staying@parklane.test']) {
      await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email, role: email.startsWith('staying') ? 'member' : 'owner' } });
    }
    const gatewayId = '22222222-3333-4444-8555-666666666666';
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId, secret: SECRET } });
    assert.equal((await api('GET', '/api/gateway/members')).status, 401);
    assert.equal((await api('GET', '/api/gateway/members', { token: `${gatewayId}.${'b'.repeat(64)}` })).status, 401);
    assert.equal((await api('GET', '/api/gateway/members', { token: `${GW}.${SECRET}` })).data.gatewayId, GW, 'each secret opens its own gateway only');
    const synced = await api<{ gatewayId: string; unitId: string; members: { userId: string; role: string }[] }>('GET', '/api/gateway/members', {
      token: `${gatewayId}.${SECRET}`,
    });
    assert.equal(synced.data.unitId, unitId);
    const byId = (a: { userId: string }, b: { userId: string }) => a.userId.localeCompare(b.userId);
    assert.deepEqual(
      synced.data.members.map(({ userId, role }) => ({ userId, role })).sort(byId),
      [
        { userId: leaving.id, role: 'owner' },
        { userId: staying.id, role: 'member' },
      ].sort(byId),
    );
    // Moving the resident to another apartment takes them off this gateway's list.
    const other = await unit('Tower C · 0808');
    await api('POST', `/api/admin/units/${other}/members`, { token: ADMIN, body: { email: 'leaving@parklane.test' } });
    const after = await api<{ members: { userId: string }[] }>('GET', '/api/gateway/members', { token: `${gatewayId}.${SECRET}` });
    assert.deepEqual(after.data.members.map((m) => m.userId), [staying.id]);
    const listed = await api<{ id: string; lastSync: string | null }[]>('GET', '/api/admin/gateways', { token: ADMIN });
    assert.ok(listed.data.find((g) => g.id === gatewayId)?.lastSync);
  });

  test('a phone lives as long as its session: removing it on the gateway ends its session', async () => {
    const unitId = await unit('Tower E · 0505');
    const gatewayId = '33333333-4444-4555-8666-777777777777';
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId, secret: SECRET } });
    const email = 'lost-phone@parklane.test';
    const lostPhone = await resident(email);
    await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email } });
    const newPhone = (await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'correct horse battery' } })).data.token;
    const key = (await api<{ key: string }>('GET', '/api/gateway/key')).data.key;
    const sidOf = async (token: string) => String(openPass((await api<Pass>('POST', '/api/gateway/pass', { token })).data.pass, key).sid);
    const lostSid = await sidOf(lostPhone.token);
    const newSid = await sidOf(newPhone);
    assert.notEqual(lostSid, newSid, 'each session has its own id');
    assert.equal(lostSid.length, 24);
    const gatewayAuth = `${gatewayId}.${SECRET}`;
    const sessions = async () =>
      (await api<{ members: { sessions: string[] }[] }>('GET', '/api/gateway/members', { token: gatewayAuth })).data.members[0].sessions.sort();
    assert.deepEqual(await sessions(), [lostSid, newSid].sort());

    // The owner removed the lost phone on the gateway; the gateway ends its session here.
    assert.deepEqual((await api('POST', '/api/gateway/sessions/revoke', { token: gatewayAuth, body: { sessions: [lostSid, 'not-a-session'] } })).data, { revoked: 1 });
    assert.equal((await api('GET', '/api/auth/me', { token: lostPhone.token })).status, 401);
    assert.equal((await api('POST', '/api/gateway/pass', { token: lostPhone.token })).status, 401, 'the lost phone can\'t ask for a new pass');
    assert.equal((await api('GET', '/api/auth/me', { token: newPhone })).status, 200);
    assert.deepEqual(await sessions(), [newSid]);

    // A gateway can't end sessions of people who aren't its residents.
    const outsider = await resident('outsider@parklane.test');
    const otherUnit = await unit('Tower E · 0606');
    await api('POST', `/api/admin/units/${otherUnit}/members`, { token: ADMIN, body: { email: 'outsider@parklane.test' } });
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId: otherUnit, gatewayId: '44444444-5555-4666-8777-888888888888', secret: SECRET } });
    const outsiderSid = await sidOf(outsider.token);
    assert.deepEqual((await api('POST', '/api/gateway/sessions/revoke', { token: gatewayAuth, body: { sessions: [outsiderSid] } })).data, { revoked: 0 });
    assert.equal((await api('GET', '/api/auth/me', { token: outsider.token })).status, 200);
  });

  test('signing out the other phones ends every other session, and they drop off the members list', async () => {
    const unitId = await unit('Tower F · 0101');
    const gatewayId = '55555555-6666-4777-8888-999999999999';
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId, secret: SECRET } });
    const email = 'many-phones@parklane.test';
    const first = await resident(email);
    await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email } });
    const login = async () => (await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'correct horse battery' } })).data.token;
    const second = await login();
    const third = await login();
    assert.deepEqual((await api('POST', '/api/auth/logout-others', { token: third })).data, { revoked: 2 });
    for (const [token, status] of [[first.token, 401], [second, 401], [third, 200]] as const) {
      assert.equal((await api('GET', '/api/auth/me', { token })).status, status);
    }
    const members = await api<{ members: { sessions: string[] }[] }>('GET', '/api/gateway/members', { token: `${gatewayId}.${SECRET}` });
    assert.equal(members.data.members[0].sessions.length, 1);
  });

  test('attaching checks its input and replaces an older attachment', async () => {
    const unitId = await unit('Tower D · 0101');
    for (const body of [
      { unitId, gatewayId: 'not-a-uuid', secret: SECRET },
      { unitId, gatewayId: GW, secret: 'short' },
      { unitId, gatewayId: GW, secret: SECRET, url: 'http://insecure.example.com' },
    ]) {
      assert.equal((await api('POST', '/api/admin/gateways', { token: ADMIN, body })).status, 400);
    }
    assert.equal((await api('POST', '/api/admin/gateways', { body: { unitId, gatewayId: GW, secret: SECRET } })).status, 401);
    assert.equal((await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId: 'nope', gatewayId: GW, secret: SECRET } })).status, 404);
    // The gateway moves to this unit: it no longer serves the first one.
    await api('POST', '/api/admin/gateways', { token: ADMIN, body: { unitId, gatewayId: GW, secret: SECRET } });
    const listed = await api<{ id: string; unitId: string }[]>('GET', '/api/admin/gateways', { token: ADMIN });
    assert.deepEqual(listed.data.filter((g) => g.id === GW).map((g) => g.unitId), [unitId]);
    assert.deepEqual((await api('DELETE', `/api/admin/gateways/${GW}`, { token: ADMIN })).data, { deleted: true });
  });
});
