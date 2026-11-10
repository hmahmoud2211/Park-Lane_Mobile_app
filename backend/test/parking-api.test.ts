import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Phase 5 of the real backend: parking over HTTP. An apartment sees its own bookings and only the bay and time of
 * others'; the visitor's link opens one booking and nothing else; gate staff scan the pass; cancelling closes the
 * link; the minute sweep marks no-shows; deleting an account cancels its upcoming bookings and forgets the person.
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
const ADMIN = 'admin-key-for-phase-5-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-phase5-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
  PUBLIC_URL: BASE,
});

/** Monday 2 November 2026, 08:00 in Cairo (UTC+2). */
const NOW = Date.parse('2026-11-02T08:00:00+02:00');
mock.timers.enable({ apis: ['Date'], now: NOW });
const H = 3600_000;

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { createUser } = await import('../src/ems/auth.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { sweepParking } = await import('../src/parking/accounts.ts');

let server: Server;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});
after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  mock.timers.reset();
});
beforeEach(() => resetLimits());

interface Answer<T> {
  status: number;
  data: T;
  error?: { code: string; message: string; field?: string };
  headers: Headers;
  text?: string;
}

async function api<T = Record<string, any>>(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Answer<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!(response.headers.get('content-type') ?? '').includes('json')) return { status: response.status, data: undefined as T, headers: response.headers, text: await response.text() };
  const parsed = (await response.json()) as Record<string, any>;
  return { status: response.status, data: parsed.data as T, error: parsed.error, headers: response.headers };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

const PASSWORD = 'correct horse battery';
let counter = 0;
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `p5-${counter}@phase5.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: PASSWORD, name } }));
  return { token, id: user.id, email };
}
type Person = Awaited<ReturnType<typeof resident>>;

async function apartment(name: string, tower: string, owner: Person, ...members: Person[]) {
  const unit = ok(await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } }));
  ok(await api('PUT', `/api/admin/units/${unit.id}/details`, { token: ADMIN, body: { tower } }));
  ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: owner.email, role: 'owner' } }));
  for (const member of members) ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: member.email, role: 'member' } }));
  return unit.id;
}

async function gateStaff() {
  const email = `gate-${++counter}@phase5.test`;
  const staff = await createUser(email, 'gate staff password', 'Gate', 'security');
  resetLimits();
  return { token: ok(await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'gate staff password' } })).token, id: staff.id };
}

const inboxTitles = (userId: string) => (db().prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'parking' ORDER BY created_at, rowid").all(userId) as { title: string }[]).map((row) => row.title);

const guestBooking = (spaceId: string, start: number, end: number, name = 'Omar Khaled', plate?: string) => ({
  bookedFor: 'guest',
  guest: { name },
  vehiclePlate: plate,
  parkingType: 'standard',
  spaceId,
  start,
  end,
});

describe('Parking over HTTP', () => {
  let owner: Person;
  let neighbour: Person;
  let staff: { token: string; id: string };
  let booking: Record<string, any>;
  let inviteToken: string;
  let passToken: string;

  test('an apartment books a guest bay and sees its pass; nothing secret is stored', async () => {
    owner = await resident('Hala Owner');
    neighbour = await resident('Nabil Neighbour');
    staff = await gateStaff();
    await apartment('Tower A · 302', 'A', owner);
    await apartment('Tower B · 1104', 'B', neighbour);

    const empty = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: owner.token }));
    assert.equal(empty.spaces.length, 22);
    assert.deepEqual(empty.properties.map((p: { label: string; buildingId: string }) => [p.label, p.buildingId]), [['Tower A · 302', 'bld-a']]);
    assert.equal(empty.reservations.length, 0);
    assert.equal(empty.inviteBase, `${BASE}/parking/pass`);

    const offers = ok(await api<{ space: { id: string; label: string }; available: boolean }[]>('POST', '/api/parking/search', { token: owner.token, body: { kind: 'visitor', start: NOW + 2 * H, end: NOW + 4 * H } }));
    const bay = offers.find((offer) => offer.available)!.space;
    booking = ok(await api<Record<string, any>>('POST', '/api/parking/reservations', { token: owner.token, body: guestBooking(bay.id, NOW + 2 * H, NOW + 4 * H) }));
    assert.match(booking.reference, /^PL-\d+$/);
    assert.equal(booking.propertyId !== undefined, true);

    const mine = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: owner.token }));
    const own = mine.reservations.find((r: { id: string }) => r.id === booking.id);
    assert.equal(own.guest.name, 'Omar Khaled');
    passToken = mine.credentials.find((c: { id: string }) => c.id === own.credentialId).displayToken;
    inviteToken = mine.invitations.find((i: { id: string }) => i.id === own.invitationId).inviteToken;
    assert.match(passToken, /^plq_/);
    assert.match(inviteToken, /^inv_/);

    const stored = JSON.stringify(db().prepare('SELECT * FROM parking_credentials').all()) + JSON.stringify(db().prepare('SELECT * FROM parking_invitations').all());
    assert.ok(!stored.includes(passToken) && !stored.includes(inviteToken), 'tokens are never stored');
    const reservationRow = db().prepare('SELECT data, property_id FROM parking_reservations WHERE id = ?').get(booking.id) as { data: string; property_id: string };
    assert.ok(!reservationRow.data.includes('Omar'), 'guest details are sealed');
  });

  test('another apartment sees only the bay and the time held, and cannot touch it', async () => {
    const theirs = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: neighbour.token }));
    const other = theirs.reservations.find((r: { id: string }) => r.id === booking.id);
    assert.deepEqual([other.reference, other.propertyId, other.residentId, other.guest, other.vehiclePlate, other.credentialId], ['', '', '', undefined, undefined, '']);
    assert.equal(theirs.credentials.length, 0);
    assert.equal(theirs.invitations.length, 0);
    assert.equal((await api('POST', `/api/parking/reservations/${booking.id}/cancel`, { token: neighbour.token, body: {} })).status, 404);
    const taken = await api('POST', '/api/parking/reservations', { token: neighbour.token, body: guestBooking(booking.spaceId, NOW + 2 * H, NOW + 3 * H, 'Someone Else') });
    assert.equal(taken.status, 409);
    assert.equal(taken.error?.code, 'parking_refused');
    assert.equal(taken.error?.field, 'space-unavailable');
  });

  test('the visitor\'s link opens that booking only: the page, the QR, adding a plate and asking for help', async () => {
    const page = await api('GET', `/parking/pass/${inviteToken}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.text ?? '', /pass\.js/);
    assert.equal((await api('GET', `/parking/pass/inv_${'x'.repeat(32)}`)).status, 200, 'the page shell is the same for every link');

    const pass = ok(await api<Record<string, any>>('GET', `/api/parking/pass/${inviteToken}`));
    assert.equal(pass.guestName, 'Omar Khaled');
    assert.equal(pass.plate, null);
    assert.ok(pass.qr.path.startsWith('M') && pass.qr.size > 21);
    assert.ok(pass.directions.length > 0);
    assert.equal(pass.securityPhone, null);
    assert.equal((await api('GET', `/api/parking/pass/inv_${'y'.repeat(32)}`)).status, 404);
    assert.equal((await api('GET', '/api/parking/pass/not-a-token')).status, 404);

    assert.equal((await api('POST', `/api/parking/pass/${inviteToken}/plate`, { body: { plate: 'x' } })).error?.field, 'plate');
    assert.equal(ok(await api<Record<string, any>>('POST', `/api/parking/pass/${inviteToken}/plate`, { body: { plate: 'egy 4321' } })).plate, 'EGY 4321');
    ok(await api('POST', `/api/parking/pass/${inviteToken}/help`, { body: { kind: 'contact' } }));
    assert.ok(inboxTitles(staff.id).length >= 1, 'gate staff are told');
  });

  test('gate staff scan the pass; the owner is told; residents can\'t use the desk', async () => {
    assert.equal((await api('GET', '/api/security/parking', { token: owner.token })).status, 403);
    mock.timers.setTime(NOW + 2 * H - 10 * 60_000);
    const desk = ok(await api<Record<string, any>>('GET', '/api/security/parking', { token: staff.token }));
    assert.ok(desk.expected.some((arrival: { reservationId: string }) => arrival.reservationId === booking.id));
    const bayGate = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: owner.token })).spaces.find((space: { id: string }) => space.id === booking.spaceId).gateId;
    const scan = ok(await api<Record<string, any>>('POST', '/api/security/parking/scan', { token: staff.token, body: { code: passToken, gateId: bayGate, direction: 'entry' } }));
    assert.equal(scan.outcome, 'accepted', scan.message);
    const again = ok(await api<Record<string, any>>('POST', '/api/security/parking/scan', { token: staff.token, body: { code: passToken, gateId: bayGate, direction: 'entry' } }));
    assert.equal(again.outcome, 'already-processed');
    const inside = ok(await api<Record<string, any>>('GET', '/api/security/parking', { token: staff.token })).inside;
    assert.ok(inside.some((visit: { id: string; plate: string }) => visit.id === booking.id && visit.plate === 'EGY 4321'));
    assert.ok(inboxTitles(owner.id).some((title) => /arrived|entered|in/i.test(title)), JSON.stringify(inboxTitles(owner.id)));
    assert.equal((await api('POST', '/api/security/parking/reservations/x/entry', { token: staff.token, body: { gateId: 'gate-1', reason: 'manual', plate: '!!' } })).error?.field, 'plate');
  });

  test('cancelling closes the visitor\'s link and the pass; the sweep marks a no-show', async () => {
    mock.timers.setTime(NOW);
    const offers = ok(await api<{ space: { id: string }; available: boolean }[]>('POST', '/api/parking/search', { token: owner.token, body: { kind: 'visitor', start: NOW + 6 * H, end: NOW + 7 * H } }));
    const later = ok(await api<Record<string, any>>('POST', '/api/parking/reservations', { token: owner.token, body: guestBooking(offers.find((offer) => offer.available)!.space.id, NOW + 6 * H, NOW + 7 * H, 'Second Guest', 'EGY 1111') }));
    const snapshot = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: owner.token }));
    const link = snapshot.invitations.find((i: { reservationId: string }) => i.reservationId === later.id).inviteToken;
    ok(await api('POST', `/api/parking/reservations/${later.id}/cancel`, { token: owner.token, body: {} }));
    assert.equal((await api('GET', `/api/parking/pass/${link}`)).status, 404);

    const third = ok(await api<Record<string, any>>('POST', '/api/parking/reservations', { token: owner.token, body: guestBooking(offers.find((offer) => offer.available)!.space.id, NOW + 6 * H, NOW + 7 * H, 'Third Guest', 'EGY 2222') }));
    mock.timers.setTime(NOW + 8 * H);
    assert.ok(sweepParking() >= 1);
    const row = db().prepare('SELECT status FROM parking_reservations WHERE id = ?').get(third.id) as { status: string };
    assert.equal(row.status, 'no-show');
  });

  test('deleting an account cancels its upcoming bookings and forgets the person; vehicles go too', async () => {
    mock.timers.setTime(NOW);
    const leaving = await resident('Leaving Member');
    const stays = await resident('Staying Owner');
    await apartment('Tower C · 705', 'C', stays, leaving);
    const vehicle = ok(await api<Record<string, any>>('POST', '/api/parking/vehicles', { token: leaving.token, body: { make: 'Kia', model: 'EV6', colour: 'White', plate: 'EGY 9090', ev: { connectors: ['Type 2', 'CCS2'], maxAcKw: 11, maxDcKw: 240, batteryKwh: 77 } } }));
    assert.equal(ok(await api<unknown[]>('GET', '/api/parking/vehicles', { token: leaving.token })).length, 1);
    const offers = ok(await api<{ space: { id: string }; available: boolean }[]>('POST', '/api/parking/search', { token: leaving.token, body: { kind: 'visitor', start: NOW + 26 * H, end: NOW + 27 * H } }));
    const upcoming = ok(await api<Record<string, any>>('POST', '/api/parking/reservations', { token: leaving.token, body: guestBooking(offers.find((offer) => offer.available)!.space.id, NOW + 26 * H, NOW + 27 * H, 'Their Guest') }));
    ok(await api('POST', '/api/auth/delete-account', { token: leaving.token, body: { password: PASSWORD } }));

    const row = db().prepare('SELECT status, resident_id FROM parking_reservations WHERE id = ?').get(upcoming.id) as { status: string; resident_id: string | null };
    assert.deepEqual([row.status, row.resident_id], ['cancelled', null]);
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM parking_vehicles WHERE id = ?').get(vehicle.id) as { n: number }).n, 0);
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM parking_residents WHERE id = ?').get(leaving.id) as { n: number }).n, 0);
    const forStays = ok(await api<Record<string, any>>('GET', '/api/parking/snapshot', { token: stays.token }));
    assert.equal(forStays.reservations.find((r: { id: string }) => r.id === upcoming.id)?.status, 'cancelled', 'the apartment keeps its history');
  });
});
