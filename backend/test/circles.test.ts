import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Circle, CircleInvite, CircleInvitePreview, LiveWatch, LocationReportResult, LocationToken, OpenCircleInvite } from '../../shared/contracts/circles.ts';

/**
 * Family Circle: making Circles, invite codes (also for people outside any unit), each member's own sharing, what
 * others may see, location reports and their checks, the background task's narrow token, leaving and removal, and
 * account deletion.
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
const PASSWORD = 'correct horse battery';

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-circles-')), ADMIN_API_KEY: 'admin-key-for-circle-tests' });

const { createApp } = await import('../src/app.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { db } = await import('../src/ems/db.ts');

const server = createApp();

before(async () => {
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

function ok<T>(result: Envelope<T>): T {
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return result.data;
}

let people = 0;
async function person(name: string): Promise<{ token: string; id: string }> {
  people += 1;
  const result = await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', {
    body: { email: `person${people}@circles.test`, password: PASSWORD, name },
  });
  return { token: result.data.token, id: result.data.user.id };
}

const point = (lat: number, lng: number, at = new Date(), accuracyM = 15) => ({ lat, lng, accuracyM, at: at.toISOString() });

/** A father with a Circle, and his son in it (neither lives in a unit). */
async function family(): Promise<{ father: { token: string; id: string }; son: { token: string; id: string }; circle: Circle }> {
  const father = await person('Father');
  const son = await person('Son');
  const circle = ok(await api<Circle>('POST', '/api/circles', { token: father.token, body: { name: '  Family  ' } }));
  const invite = ok(await api<CircleInvite>('POST', `/api/circles/${circle.id}/invites`, { token: father.token }));
  ok(await api('POST', '/api/circles/join', { token: son.token, body: { code: invite.code.toLowerCase() } }));
  return { father, son, circle };
}

const circleOf = async (token: string, id: string) => ok(await api<Circle[]>('GET', '/api/circles', { token })).find((circle) => circle.id === id);

describe('Circles and invites', () => {
  test('the maker owns the Circle; anyone with an account joins with a code, sharing off', async () => {
    const { father, son, circle } = await family();
    assert.equal(circle.name, 'Family');
    assert.equal(circle.role, 'owner');
    assert.equal(circle.sharing, false);

    const seen = await circleOf(son.token, circle.id);
    assert.ok(seen);
    assert.equal(seen.role, 'member');
    assert.deepEqual(
      seen.members.map((member) => [member.name, member.role, member.you, member.sharing]),
      [
        ['Father', 'owner', false, false],
        ['Son', 'member', true, false],
      ],
    );
    assert.equal((await circleOf(father.token, circle.id))?.members.length, 2);
  });

  test('a code can be checked first, works once, and an unknown code is refused', async () => {
    const owner = await person('Owner');
    const circle = ok(await api<Circle>('POST', '/api/circles', { token: owner.token, body: { name: 'Friends' } }));
    const invite = ok(await api<CircleInvite>('POST', `/api/circles/${circle.id}/invites`, { token: owner.token }));
    assert.match(invite.code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    const first = await person('First');
    const preview = ok(await api<CircleInvitePreview>('POST', '/api/circles/invites/check', { token: first.token, body: { code: invite.code } }));
    assert.deepEqual(preview.circle, { name: 'Friends', members: 1 });
    assert.equal(preview.invitedBy, 'Owner');
    assert.equal(preview.alreadyMember, false);

    const listed = ok(await api<OpenCircleInvite[]>('GET', `/api/circles/${circle.id}/invites`, { token: owner.token }));
    assert.deepEqual(listed.map((open) => open.id), [invite.id]);

    ok(await api('POST', '/api/circles/join', { token: first.token, body: { code: invite.code } }));
    // Using it again is harmless for the person it was for, and refused for anyone else.
    ok(await api('POST', '/api/circles/join', { token: first.token, body: { code: invite.code } }));
    const second = await person('Second');
    assert.equal((await api('POST', '/api/circles/join', { token: second.token, body: { code: invite.code } })).error?.code, 'invite_used');
    assert.equal((await api('POST', '/api/circles/join', { token: second.token, body: { code: 'ABCD-EFGH' } })).error?.code, 'invalid');
  });

  test('only owners invite, rename and remove; outsiders get 404', async () => {
    const { son, circle } = await family();
    assert.equal((await api('POST', `/api/circles/${circle.id}/invites`, { token: son.token })).status, 403);
    assert.equal((await api('PATCH', `/api/circles/${circle.id}`, { token: son.token, body: { name: 'Mine' } })).status, 403);
    assert.equal((await api('DELETE', `/api/circles/${circle.id}`, { token: son.token })).status, 403);

    const stranger = await person('Stranger');
    assert.equal((await api('PUT', `/api/circles/${circle.id}/sharing`, { token: stranger.token, body: { sharing: true } })).status, 404);
    assert.equal((await api('GET', `/api/circles/${circle.id}/invites`, { token: stranger.token })).status, 404);
    assert.equal(await circleOf(stranger.token, circle.id), undefined);
  });

  test('a name is required, and cancelled invites stop working', async () => {
    const owner = await person('Owner');
    assert.equal((await api('POST', '/api/circles', { token: owner.token, body: { name: '   ' } })).status, 400);
    const circle = ok(await api<Circle>('POST', '/api/circles', { token: owner.token, body: { name: 'Home' } }));
    const invite = ok(await api<CircleInvite>('POST', `/api/circles/${circle.id}/invites`, { token: owner.token }));
    assert.deepEqual(ok(await api('DELETE', `/api/circles/${circle.id}/invites/${invite.id}`, { token: owner.token })), []);
    const late = await person('Late');
    assert.equal((await api('POST', '/api/circles/join', { token: late.token, body: { code: invite.code } })).error?.code, 'invalid');
  });

  test('an owner who leaves hands the Circle on; the last one to leave removes it', async () => {
    const { father, son, circle } = await family();
    const invite = ok(await api<CircleInvite>('POST', `/api/circles/${circle.id}/invites`, { token: father.token }));
    ok(await api('DELETE', `/api/circles/${circle.id}/members/${father.id}`, { token: father.token }));

    const seen = await circleOf(son.token, circle.id);
    assert.equal(seen?.role, 'owner');
    assert.equal(seen?.members.length, 1);
    // The leaving owner's open invite ended with them (removed, so the code is unknown now).
    const late = await person('Late');
    assert.equal((await api('POST', '/api/circles/join', { token: late.token, body: { code: invite.code } })).error?.code, 'invalid');

    ok(await api('DELETE', `/api/circles/${circle.id}/members/${son.id}`, { token: son.token }));
    assert.equal(db().prepare('SELECT 1 FROM circles WHERE id = ?').get(circle.id), undefined);
  });
});

describe('sharing and positions', () => {
  test('a position is seen only by people in a Circle where its owner shares', async () => {
    const { father, son, circle } = await family();

    // Not sharing yet: the report is not kept, and the phone is told to stop.
    assert.deepEqual(
      ok(await api<LocationReportResult>('POST', '/api/location/report', { token: son.token, body: { points: [point(30.05, 31.23)], battery: null } })),
      { accepted: false, sharing: false, liveUntil: null },
    );

    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));
    const report = { points: [point(30.04, 31.2, new Date(Date.now() - 60_000)), point(30.05, 31.23)], battery: { level: 0.734, charging: true } };
    assert.deepEqual(ok(await api<LocationReportResult>('POST', '/api/location/report', { token: son.token, body: report })), { accepted: true, sharing: true, liveUntil: null });

    const sonSeen = (await circleOf(father.token, circle.id))?.members.find((member) => member.userId === son.id);
    assert.equal(sonSeen?.sharing, true);
    assert.equal(sonSeen?.location?.lat, 30.05);
    assert.equal(sonSeen?.location?.lng, 31.23);
    assert.deepEqual(sonSeen?.battery, { level: 0.73, charging: true });

    // The point is sealed at rest.
    const stored = db().prepare('SELECT point FROM member_locations WHERE user_id = ?').get(son.id) as { point: string };
    assert.doesNotMatch(stored.point, /30\.05/);

    // Someone in another Circle with the father only sees nothing of the son.
    const other = ok(await api<Circle>('POST', '/api/circles', { token: father.token, body: { name: 'Work' } }));
    const colleague = await person('Colleague');
    const invite = ok(await api<CircleInvite>('POST', `/api/circles/${other.id}/invites`, { token: father.token }));
    ok(await api('POST', '/api/circles/join', { token: colleague.token, body: { code: invite.code } }));
    const colleagueView = ok(await api<Circle[]>('GET', '/api/circles', { token: colleague.token }));
    assert.ok(colleagueView.every((seen) => seen.members.every((member) => member.userId !== son.id)));

    // Turning sharing off hides the position and deletes it.
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: false } }));
    const hidden = (await circleOf(father.token, circle.id))?.members.find((member) => member.userId === son.id);
    assert.equal(hidden?.location, null);
    assert.equal(hidden?.battery, null);
    assert.equal(db().prepare('SELECT 1 FROM member_locations WHERE user_id = ?').get(son.id), undefined);
  });

  test('older points are ignored, bad ones refused or dropped', async () => {
    const { son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));
    ok(await api('POST', '/api/location/report', { token: son.token, body: { points: [point(30.05, 31.23)], battery: null } }));

    const older = await api<LocationReportResult>('POST', '/api/location/report', {
      token: son.token,
      body: { points: [point(10, 10, new Date(Date.now() - 600_000))], battery: null },
    });
    assert.deepEqual(ok(older), { accepted: false, sharing: true, liveUntil: null });

    for (const body of [
      { points: [], battery: null },
      { points: [{ lat: 91, lng: 0, accuracyM: 5, at: new Date().toISOString() }], battery: null },
      { points: [point(1, 1)], battery: { level: 2, charging: false } },
      { points: Array.from({ length: 201 }, () => point(1, 1)), battery: null },
    ]) {
      assert.equal((await api('POST', '/api/location/report', { token: son.token, body })).status, 400, JSON.stringify(body).slice(0, 80));
    }

    // Too rough, or from the future: dropped quietly, nothing replaced.
    const dropped = await api<LocationReportResult>('POST', '/api/location/report', {
      token: son.token,
      body: { points: [point(1, 1, new Date(), 5000), point(2, 2, new Date(Date.now() + 3_600_000))], battery: null },
    });
    assert.deepEqual(ok(dropped), { accepted: false, sharing: true, liveUntil: null });
  });

  test('a removed member stops being seen and stops seeing', async () => {
    const { father, son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));
    ok(await api('POST', '/api/location/report', { token: son.token, body: { points: [point(30.05, 31.23)], battery: null } }));

    ok(await api('DELETE', `/api/circles/${circle.id}/members/${son.id}`, { token: father.token }));
    assert.equal(await circleOf(son.token, circle.id), undefined);
    assert.equal(db().prepare('SELECT 1 FROM member_locations WHERE user_id = ?').get(son.id), undefined);
    assert.deepEqual(
      ok(await api<LocationReportResult>('POST', '/api/location/report', { token: son.token, body: { points: [point(30.06, 31.24)], battery: null } })),
      { accepted: false, sharing: false, liveUntil: null },
    );
  });

  test('the father’s open app gets the son’s new position over the realtime channel', async () => {
    const { father, son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));

    const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
    const messages: { type: string; member?: { userId: string; location: { lat: number } | null } }[] = [];
    await new Promise<void>((resolve) => {
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: father.token })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        messages.push(message);
        if (message.type === 'ready') resolve();
      });
    });
    const moved = new Promise<void>((resolve) => {
      socket.addEventListener('message', (event) => {
        if (String(event.data).includes('location.updated')) resolve();
      });
    });
    ok(await api('POST', '/api/location/report', { token: son.token, body: { points: [point(30.07, 31.25)], battery: null } }));
    await moved;
    socket.close();
    const update = messages.find((message) => message.type === 'location.updated');
    assert.equal(update?.member?.userId, son.id);
    assert.equal(update?.member?.location?.lat, 30.07);
  });
});

describe('live view', () => {
  test('an open map makes the Circle’s sharing members live, told at once and in their next report', async () => {
    const { father, son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));

    // The son's open app hears it straight away.
    const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
    await new Promise<void>((resolve) => {
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: son.token })));
      socket.addEventListener('message', (event) => {
        if (String(event.data).includes('ready')) resolve();
      });
    });
    const told = new Promise<{ type: string; until: number }>((resolve) => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'location.live') resolve(message);
      });
    });

    const before = Date.now();
    const watch = ok(await api<LiveWatch>('POST', '/api/location/watch', { token: father.token, body: { circleId: circle.id } }));
    assert.equal(watch.members, 1);
    assert.ok(watch.liveUntil >= before + 55_000 && watch.liveUntil <= Date.now() + 61_000);
    assert.equal((await told).until, watch.liveUntil);
    socket.close();

    // And a closed app learns it from the answer to its next report.
    const report = ok(await api<LocationReportResult>('POST', '/api/location/report', { token: son.token, body: { points: [point(30.05, 31.23)], battery: null } }));
    assert.equal(report.liveUntil, watch.liveUntil);

    // The watcher's own phone isn't made live by watching.
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: father.token, body: { sharing: true } }));
    const own = ok(await api<LocationReportResult>('POST', '/api/location/report', { token: father.token, body: { points: [point(30.01, 31.2)], battery: null } }));
    assert.equal(own.liveUntil, null);
  });

  test('members who don’t share are never made live, and outsiders can’t watch', async () => {
    const { father, son, circle } = await family();
    assert.equal(ok(await api<LiveWatch>('POST', '/api/location/watch', { token: father.token, body: { circleId: circle.id } })).members, 0);
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));
    const report = ok(await api<LocationReportResult>('POST', '/api/location/report', { token: son.token, body: { points: [point(30.05, 31.23)], battery: null } }));
    assert.equal(report.liveUntil, null);

    const stranger = await person('Stranger');
    assert.equal((await api('POST', '/api/location/watch', { token: stranger.token, body: { circleId: circle.id } })).status, 404);
    assert.equal((await api('POST', '/api/location/watch', { token: stranger.token, body: {} })).status, 404);
  });
});

describe('the background task’s location token', () => {
  test('it can send reports and nothing else, and signing out ends it', async () => {
    const { son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: son.token, body: { sharing: true } }));
    const { token } = ok(await api<LocationToken>('POST', '/api/location/token', { token: son.token }));

    ok(await api('POST', '/api/location/report', { token, body: { points: [point(30.05, 31.23)], battery: null } }));
    assert.equal((await api('GET', '/api/circles', { token })).status, 401);
    assert.equal((await api('POST', '/api/location/token', { token })).status, 401);
    assert.equal((await api('GET', '/api/unit', { token })).status, 401);

    ok(await api('POST', '/api/auth/logout', { token: son.token }));
    assert.equal((await api('POST', '/api/location/report', { token, body: { points: [point(30.06, 31.24)], battery: null } })).status, 401);
  });
});

describe('account deletion', () => {
  test('deleting the owner’s account hands the Circle on and removes their rows', async () => {
    const { father, son, circle } = await family();
    ok(await api('PUT', `/api/circles/${circle.id}/sharing`, { token: father.token, body: { sharing: true } }));
    ok(await api('POST', '/api/location/report', { token: father.token, body: { points: [point(30.05, 31.23)], battery: null } }));

    ok(await api('POST', '/api/auth/delete-account', { token: father.token, body: { password: PASSWORD } }));
    const seen = await circleOf(son.token, circle.id);
    assert.equal(seen?.role, 'owner');
    assert.deepEqual(seen?.members.map((member) => member.name), ['Son']);
    assert.equal(db().prepare('SELECT 1 FROM member_locations WHERE user_id = ?').get(father.id), undefined);
    assert.equal(db().prepare('SELECT 1 FROM circle_members WHERE user_id = ?').get(father.id), undefined);
  });
});
