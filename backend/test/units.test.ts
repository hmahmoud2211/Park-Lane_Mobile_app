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

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-units-')), ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'https://parklane.test' });

const { createApp } = await import('../src/app.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { insertInvite } = await import('../src/repositories/unitInvites.ts');
const { sha256 } = await import('../src/ems/secrets.ts');
const { clientIp, limitKeyOf } = await import('../src/ems/rateLimit.ts');

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
    assert.equal(reused.status, 410);
    assert.equal(reused.error?.code, 'invite_used');
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

describe('invites that are easy to share and hard to misuse', () => {
  interface Preview {
    unit: { name: string; building: string | null };
    invitedBy: string;
    role: string;
    alreadyMember: boolean;
  }
  interface Open {
    id: string;
    role: string;
    invitedBy: string;
    expiresAt: number;
  }

  test('an invite comes with a link; the invited person sees the apartment before joining and the owner is told', async () => {
    const { owner } = await owned('Tower G · 0707', 'owner-g@units.test');
    const invite = await api<{ id: string; code: string; link: string }>('POST', '/api/unit/invites', { token: owner.token, body: {} });
    // The code goes after #, which browsers never send: it stays out of every server log.
    assert.equal(invite.data.link, `https://parklane.test/join#${invite.data.code}`);
    assert.match(invite.data.id, /^\d+$/, 'a row number, unrelated to the code');

    const family = await resident('family-g@units.test');
    // The whole message pasted, or the link, works as well as the code.
    const message = `Join our apartment in the Parklane app: ${invite.data.link} or enter code ${invite.data.code} (valid 24 hours)`;
    const preview = await api<Preview>('POST', '/api/unit/invites/check', { token: family.token, body: { code: message } });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.unit.name, 'Tower G · 0707');
    assert.ok(preview.data.invitedBy.length > 0);
    assert.equal(preview.data.role, 'member');
    assert.equal(preview.data.alreadyMember, false);
    assert.equal((await api<Preview>('POST', '/api/unit/invites/check', { token: owner.token, body: { code: invite.data.code } })).data.alreadyMember, true);
    assert.equal((await api('GET', '/api/unit', { token: family.token })).error?.code, 'no_home', 'checking does not join');

    const joined = await api<Unit>('POST', '/api/unit/join', { token: family.token, body: { code: invite.data.link } });
    assert.equal(joined.status, 200);
    // Tapping the same link again later is harmless.
    assert.equal((await api<Unit>('POST', '/api/unit/join', { token: family.token, body: { code: invite.data.code } })).status, 200);
    assert.equal((await api<Preview>('POST', '/api/unit/invites/check', { token: family.token, body: { code: invite.data.code } })).data.alreadyMember, true);

    const inbox = await api<{ items: { title: string; kind: string }[] }>('GET', '/api/notifications', { token: owner.token });
    assert.ok(inbox.data.items.some((item) => item.kind === 'account' && /joined Tower G · 0707/.test(item.title)), JSON.stringify(inbox.data.items));
  });

  test('a wrong, a used and an expired code each say so', async () => {
    const { unitId, owner } = await owned('Tower H · 0808', 'owner-h@units.test');
    const someone = await resident('someone-h@units.test');
    const wrong = await api('POST', '/api/unit/invites/check', { token: someone.token, body: { code: 'ZZZZ-ZZZZ' } });
    assert.deepEqual([wrong.status, wrong.error?.code], [422, 'invalid']);

    // Made before codes were keyed: still found by its plain hash.
    const expiredCode = 'EXPD-2345';
    insertInvite(sha256(`unit-invite:${expiredCode}`), unitId, 'member', owner.id, Date.now() - 25 * 3600_000, Date.now() - 3600_000);
    for (const path of ['/api/unit/invites/check', '/api/unit/join']) {
      const expired = await api('POST', path, { token: someone.token, body: { code: expiredCode } });
      assert.deepEqual([expired.status, expired.error?.code], [410, 'invite_expired'], path);
    }

    const code = (await api<{ code: string }>('POST', '/api/unit/invites', { token: owner.token, body: {} })).data.code;
    const first = await resident('first-h@units.test');
    await api('POST', '/api/unit/join', { token: first.token, body: { code } });
    const used = await api('POST', '/api/unit/invites/check', { token: someone.token, body: { code } });
    assert.deepEqual([used.status, used.error?.code], [410, 'invite_used']);
  });

  test('owners see the invites still waiting and can cancel one; members cannot', async () => {
    const { owner } = await owned('Tower J · 0909', 'owner-j@units.test');
    const one = await api<{ id: string; code: string }>('POST', '/api/unit/invites', { token: owner.token, body: {} });
    const two = await api<{ id: string; code: string }>('POST', '/api/unit/invites', { token: owner.token, body: { role: 'owner' } });
    const open = await api<Open[]>('GET', '/api/unit/invites', { token: owner.token });
    assert.deepEqual(open.data.map((entry) => [entry.id, entry.role]), [
      [two.data.id, 'owner'],
      [one.data.id, 'member'],
    ]);
    assert.ok(open.data.every((entry) => entry.invitedBy.length > 0 && !('code' in entry)));

    const left = await api<Open[]>('DELETE', `/api/unit/invites/${two.data.id}`, { token: owner.token });
    assert.deepEqual(left.data.map((entry) => entry.id), [one.data.id]);
    assert.equal((await api('DELETE', `/api/unit/invites/${two.data.id}`, { token: owner.token })).status, 404, 'already cancelled');
    const late = await resident('late-j@units.test');
    assert.equal((await api('POST', '/api/unit/join', { token: late.token, body: { code: two.data.code } })).error?.code, 'invalid', 'a cancelled code is gone');

    await api('POST', '/api/unit/join', { token: late.token, body: { code: one.data.code } });
    assert.deepEqual((await api<Open[]>('GET', '/api/unit/invites', { token: owner.token })).data, [], 'used invites leave the list');
    assert.equal((await api('GET', '/api/unit/invites', { token: late.token })).status, 403);
    const fresh = await api<{ id: string }>('POST', '/api/unit/invites', { token: owner.token, body: {} });
    assert.equal((await api('DELETE', `/api/unit/invites/${fresh.data.id}`, { token: late.token })).status, 403);
  });

  test("a removed owner's invites stop working", async () => {
    const { owner } = await owned('Tower K · 1010', 'owner-k@units.test');
    const partnerCode = (await api<{ code: string }>('POST', '/api/unit/invites', { token: owner.token, body: { role: 'owner' } })).data.code;
    const partner = await resident('partner-k@units.test');
    await api('POST', '/api/unit/join', { token: partner.token, body: { code: partnerCode } });
    const code = (await api<{ code: string }>('POST', '/api/unit/invites', { token: partner.token, body: {} })).data.code;
    await api('DELETE', `/api/unit/members/${partner.id}`, { token: owner.token });
    const someone = await resident('someone-k@units.test');
    const refused = await api('POST', '/api/unit/join', { token: someone.token, body: { code } });
    // The trigger deleted their unused codes, so it reads as an unknown code.
    assert.deepEqual([refused.status, refused.error?.code], [422, 'invalid']);
    assert.deepEqual((await api<Open[]>('GET', '/api/unit/invites', { token: owner.token })).data, []);
    assert.equal((await api('GET', '/api/unit', { token: someone.token })).error?.code, 'no_home');
  });

  test('the invite link opens a page that is never cached, and the code stays out of the access log', async () => {
    const page = await fetch(`${BASE}/join`);
    assert.equal(page.status, 200);
    assert.equal((await fetch(`${BASE}/join/ABCD-EFGH`)).status, 200, 'a code typed into the address bar');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /Open in the Parklane app/);
    assert.equal((await fetch(`${BASE}/public/join.js`)).status, 200);
    assert.equal((await fetch(`${BASE}/join/not-a-code-at-all`)).status, 404);
  });
});

describe('limits that a caller cannot dodge', () => {
  test("an owner's open invites end when they stop being an owner", async () => {
    const { unitId, owner } = await owned('Tower L · 1111', 'owner-l@units.test');
    const partnerCode = (await api<{ code: string }>('POST', '/api/unit/invites', { token: owner.token, body: { role: 'owner' } })).data.code;
    const partner = await resident('partner-l@units.test');
    await api('POST', '/api/unit/join', { token: partner.token, body: { code: partnerCode } });
    for (let i = 0; i < 10; i += 1) await api('POST', '/api/unit/invites', { token: partner.token, body: {} });
    assert.equal((await api('POST', '/api/unit/invites', { token: owner.token, body: {} })).status, 429, 'ten waiting');
    // Building management takes the partner out: their ten codes go with them, so the owner can invite again.
    await api('DELETE', `/api/admin/units/${unitId}/members/${partner.id}`, { token: ADMIN });
    assert.equal((await api('POST', '/api/unit/invites', { token: owner.token, body: {} })).status, 200);
  });

  test('rate limits key on the address our proxies saw, and on an IPv6 caller\'s /64', () => {
    assert.equal(limitKeyOf('203.0.113.9'), '203.0.113.9');
    assert.equal(limitKeyOf('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(limitKeyOf('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
    assert.equal(limitKeyOf('2001:db8:aa:bb::7'), '2001:db8:aa:bb::/64');
    assert.equal(limitKeyOf('2001:db8::1'), '2001:db8:0:0::/64');
    // TRUST_PROXY is off in these tests: forwarded headers are ignored.
    const req = { headers: { 'x-forwarded-for': '198.51.100.1', 'cf-connecting-ip': '198.51.100.2' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(clientIp(req as never), '127.0.0.1');
  });
});

