import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Phase 3 of the real backend: maintenance, housekeeping and moving requests. The site's rules, the resident's
 * own unit only, management's assign / start / complete / cancel steps (one winner when two act at once), comments,
 * sealed photos behind signed links, inbox messages, and what stays when a resident deletes their account.
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
const ADMIN = 'admin-key-for-phase-3-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-phase3-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
});

/** Monday 2 November 2026, 08:00 in Cairo (UTC+2). */
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T08:00:00+02:00') });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { photosFolder, sweepOrphanPhotos } = await import('../src/requests/serviceRequests.ts');

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
}

async function api<T = Record<string, any>>(method: string, path: string, options: { token?: string; body?: unknown; raw?: Buffer } = {}): Promise<Answer<T>> {
  const response = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.raw ? new Uint8Array(options.raw) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    return { status: response.status, data: Buffer.from(await response.arrayBuffer()) as unknown as T };
  }
  const parsed = (await response.json()) as Record<string, any>;
  return { status: response.status, data: parsed.data as T, error: parsed.error };
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
  const email = `p3-${counter}@phase3.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: PASSWORD, name } }));
  return { token, id: user.id, email };
}
type Person = Awaited<ReturnType<typeof resident>>;

async function apartment(name: string, owner: Person, ...members: Person[]) {
  const unit = ok(await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } }));
  ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: owner.email, role: 'owner' } }));
  for (const member of members) ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: member.email, role: 'member' } }));
  return unit.id;
}

const notificationsOf = (userId: string) =>
  db().prepare("SELECT title, body FROM notifications WHERE user_id = ? AND kind = 'requests' ORDER BY created_at, rowid").all(userId) as { title: string; body: string | null }[];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not a real picture, but the right first bytes')]);

const leak = { kind: 'maintenance', category: 'plumbing', title: 'Kitchen sink leaking', details: 'Water under the sink since this morning.', preferredDate: '2026-11-03', preferredWindow: '09:00-12:00' };

describe('Service requests', () => {
  test('the form follows the site rules: categories, windows, days and the emergency number', async () => {
    const owner = await resident('Options Owner');
    await apartment('Tower B · 101', owner);
    const options = ok(await api<Record<string, any>>('GET', '/api/requests/options?kind=maintenance', { token: owner.token }));
    assert.equal(options.categories.length, 9);
    assert.deepEqual(options.windows, ['09:00-12:00', '12:00-15:00', '15:00-18:00']);
    assert.equal(options.firstDate, '2026-11-03');
    assert.equal(options.lastDate, '2026-11-16');
    assert.equal(options.emergencyPhone, null);
    assert.equal(options.timezone, 'Africa/Cairo');
    assert.equal(options.unitName, 'Tower B · 101');

    const housekeeping = ok(await api<Record<string, any>>('GET', '/api/requests/options?kind=housekeeping', { token: owner.token }));
    assert.deepEqual(housekeeping.categories.map((category: { id: string }) => category.id), ['standard', 'deep', 'windows']);
    const moving = ok(await api<Record<string, any>>('GET', '/api/requests/options?kind=moving', { token: owner.token }));
    assert.deepEqual(moving.categories.map((category: { id: string }) => category.id), ['move_in', 'move_out']);
    assert.equal((await api('GET', '/api/requests/options?kind=gardening', { token: owner.token })).status, 422);

    ok(await api('PUT', '/api/admin/sites/park-lane/settings', { token: ADMIN, body: { emergencyPhone: '+20 2 1234 5678', maintenance: { leadDays: 0, horizonDays: 7 } } }));
    const changed = ok(await api<Record<string, any>>('GET', '/api/requests/options', { token: owner.token }));
    assert.equal(changed.emergencyPhone, '+20 2 1234 5678');
    assert.equal(changed.firstDate, '2026-11-02');
    assert.equal(changed.lastDate, '2026-11-09');
    ok(await api('PUT', '/api/admin/sites/park-lane/settings', { token: ADMIN, body: { emergencyPhone: null, maintenance: { leadDays: 1, horizonDays: 14 } } }));

    // Management can switch a category off; the form stops offering it and the server refuses it.
    ok(await api('PUT', '/api/admin/service-categories/maintenance/pest', { token: ADMIN, body: { active: false } }));
    const withoutPest = ok(await api<Record<string, any>>('GET', '/api/requests/options', { token: owner.token }));
    assert.equal(withoutPest.categories.some((category: { id: string }) => category.id === 'pest'), false);
    const refused = await api('POST', '/api/requests', { token: owner.token, body: { ...leak, category: 'pest' } });
    assert.equal(refused.status, 422);
    assert.equal(refused.error?.field, 'category');
    ok(await api('PUT', '/api/admin/service-categories/maintenance/pest', { token: ADMIN, body: { active: true } }));

    const homeless = await resident('No Apartment');
    assert.equal((await api('GET', '/api/requests/options', { token: homeless.token })).error?.code, 'no_home');
  });

  test('a compound added later starts with the default categories', async () => {
    const { insertSite } = await import('../src/repositories/sites.ts');
    insertSite({ id: 'later-compound', name: 'Later', timezone: 'Africa/Cairo', kind: 'demo', createdAt: new Date().toISOString() });
    const person = await resident('Later Resident');
    const unitId = await apartment('Later · 1', person);
    db().prepare('UPDATE units SET site_id = ? WHERE id = ?').run('later-compound', unitId);
    const options = ok(await api<Record<string, any>>('GET', '/api/requests/options?kind=housekeeping', { token: person.token }));
    assert.deepEqual(options.categories.map((category: { id: string }) => category.id), ['standard', 'deep', 'windows']);
    assert.equal(ok(await api<Record<string, any>>('POST', '/api/requests', { token: person.token, body: leak })).categoryTitle, 'Plumbing');
  });

  test('a resident asks for a visit; the unit sees it, other units do not; the details are sealed', async () => {
    const owner = await resident('Request Owner');
    const family = await resident('Request Family');
    const neighbour = await resident('Neighbour');
    await apartment('Tower B · 202', owner, family);
    await apartment('Tower B · 203', neighbour);

    for (const [body, field] of [
      [{ ...leak, category: 'gardening' }, 'category'],
      [{ ...leak, title: 'ab' }, 'title'],
      [{ ...leak, preferredDate: '2026-11-02' }, 'preferredDate'],
      [{ ...leak, preferredDate: '2026-11-17' }, 'preferredDate'],
      [{ ...leak, preferredWindow: '08:00-09:00' }, 'preferredWindow'],
      [{ ...leak, details: 'x'.repeat(501) }, 'details'],
    ] as const) {
      const answer = await api('POST', '/api/requests', { token: owner.token, body });
      assert.equal(answer.status, 422, JSON.stringify(body));
      assert.equal(answer.error?.field, field);
    }

    const created = ok(await api<Record<string, any>>('POST', '/api/requests', { token: owner.token, body: leak }));
    assert.match(created.reference, /^REQ-2026-\d{5}$/);
    assert.equal(created.status, 'submitted');
    assert.equal(created.categoryTitle, 'Plumbing');
    assert.equal(created.details, leak.details);
    assert.equal(created.createdByMe, true);
    assert.deepEqual(created.events.map((event: { status: string }) => event.status), ['submitted']);
    const stored = db().prepare('SELECT details FROM service_requests WHERE id = ?').get(created.id) as { details: string };
    assert.ok(!stored.details.includes('sink'), 'details are sealed at rest');

    const seenByFamily = ok(await api<Record<string, any>[]>('GET', '/api/requests', { token: family.token }));
    assert.equal(seenByFamily.length, 1);
    assert.equal(seenByFamily[0].createdByMe, false);
    assert.deepEqual(ok(await api<unknown[]>('GET', '/api/requests', { token: neighbour.token })), []);
    assert.equal((await api('POST', `/api/requests/${created.id}/cancel`, { token: neighbour.token })).status, 404);
    assert.equal((await api('POST', `/api/requests/${created.id}/comments`, { token: neighbour.token, body: { note: 'hi' } })).status, 404);

    const second = ok(await api<Record<string, any>>('POST', '/api/requests', { token: family.token, body: { kind: 'moving', category: 'move_in', title: 'Furniture delivery', preferredDate: '2026-11-10', preferredWindow: '12:00-15:00' } }));
    assert.equal(Number(second.reference.slice(-5)), Number(created.reference.slice(-5)) + 1);
  });

  test('management assigns, starts and completes; the unit is told at each step; one winner at a time', async () => {
    const owner = await resident('Flow Owner');
    const family = await resident('Flow Family');
    await apartment('Tower C · 301', owner, family);
    const request = ok(await api<Record<string, any>>('POST', '/api/requests', { token: owner.token, body: { ...leak, category: 'electrical', title: 'Bedroom light flickers' } }));

    const technician = ok(await api<Record<string, any>>('POST', '/api/admin/technicians', { token: ADMIN, body: { name: 'Mostafa Electric', phone: '+20 100 000 0001', trades: ['electrical'] } }));
    const sealedPhone = db().prepare('SELECT phone FROM technicians WHERE id = ?').get(technician.id) as { phone: string };
    assert.ok(!sealedPhone.phone.includes('100'), "the technician's phone is sealed at rest");
    const retired = ok(await api<Record<string, any>>('POST', '/api/admin/technicians', { token: ADMIN, body: { name: 'Retired Tech', trades: ['plumbing'], active: false } }));
    assert.equal((await api('POST', `/api/admin/technicians/${'x'.repeat(5)}`, { token: owner.token, body: {} })).status, 403);

    const booking = { technicianId: technician.id, scheduledDate: '2026-11-04', scheduledWindow: '09:00-12:00' };
    const inactive = await api('POST', `/api/admin/requests/${request.id}/assign`, { token: ADMIN, body: { ...booking, technicianId: retired.id } });
    assert.equal(inactive.error?.field, 'technicianId');
    assert.equal((await api('POST', `/api/admin/requests/${request.id}/assign`, { token: ADMIN, body: { ...booking, scheduledWindow: '12:00-09:00' } })).error?.field, 'scheduledWindow');
    assert.equal((await api('POST', `/api/admin/requests/${request.id}/status`, { token: ADMIN, body: { status: 'in_progress' } })).status, 409, 'cannot start before assigning');

    const assigned = ok(await api<Record<string, any>>('POST', `/api/admin/requests/${request.id}/assign`, { token: ADMIN, body: booking }));
    assert.equal(assigned.status, 'assigned');
    assert.equal(assigned.unitName, 'Tower C · 301');
    const residentView = ok(await api<Record<string, any>[]>('GET', '/api/requests', { token: family.token }))[0];
    assert.deepEqual(residentView.technician, { name: 'Mostafa Electric', phone: '+20 100 000 0001' });
    assert.equal(residentView.scheduledDate, '2026-11-04');

    // Two people press "Start" at once: exactly one wins.
    const starts = await Promise.all([1, 2].map(() => api('POST', `/api/admin/requests/${request.id}/status`, { token: ADMIN, body: { status: 'in_progress' } })));
    assert.deepEqual(starts.map((answer) => answer.status).sort(), [200, 409]);
    assert.equal((await api('POST', `/api/requests/${request.id}/cancel`, { token: owner.token })).status, 409, 'too late to cancel once started');
    assert.equal((await api('POST', `/api/admin/requests/${request.id}/status`, { token: ADMIN, body: { status: 'cancelled' } })).error?.field, 'note');
    const done = ok(await api<Record<string, any>>('POST', `/api/admin/requests/${request.id}/status`, { token: ADMIN, body: { status: 'completed', note: 'Replaced the driver.' } }));
    assert.deepEqual(done.events.map((event: { status: string }) => event.status), ['submitted', 'assigned', 'in_progress', 'completed']);
    assert.equal((await api('POST', `/api/admin/requests/${request.id}/status`, { token: ADMIN, body: { status: 'completed' } })).status, 409);

    for (const person of [owner, family]) {
      assert.deepEqual(
        notificationsOf(person.id).map((notification) => notification.title),
        [`${request.reference}: technician booked`, `${request.reference}: work started`, `${request.reference}: completed`],
      );
    }
    assert.equal(notificationsOf(owner.id)[0].body, 'Mostafa Electric will visit on 2026-11-04, 09:00–12:00.');

    const queue = ok(await api<Record<string, any>[]>('GET', '/api/admin/requests?status=completed', { token: ADMIN }));
    assert.ok(queue.some((row) => row.id === request.id));
    assert.ok(!ok(await api<Record<string, any>[]>('GET', '/api/admin/requests?status=open', { token: ADMIN })).some((row) => row.id === request.id));
    const audit = db().prepare("SELECT action FROM admin_audit WHERE target_id = ? ORDER BY rowid").all(request.id) as { action: string }[];
    assert.deepEqual(audit.map((row) => row.action), ['request.assign', 'request.status', 'request.status']);
  });

  test('residents cancel before work starts; comments go both ways', async () => {
    const owner = await resident('Comment Owner');
    await apartment('Tower C · 302', owner);
    const request = ok(await api<Record<string, any>>('POST', '/api/requests', { token: owner.token, body: { kind: 'housekeeping', category: 'deep', title: 'Deep clean before guests', preferredDate: '2026-11-05', preferredWindow: '12:00-15:00' } }));

    ok(await api('POST', `/api/requests/${request.id}/comments`, { token: owner.token, body: { note: 'Please bring your own ladder.' } }));
    ok(await api('POST', `/api/admin/requests/${request.id}/comments`, { token: ADMIN, body: { note: 'Noted. The team brings one.' } }));
    const seen = ok(await api<Record<string, any>[]>('GET', '/api/requests', { token: owner.token }))[0];
    assert.deepEqual(
      seen.events.filter((event: { kind: string }) => event.kind === 'comment').map((event: { note: string; byStaff: boolean }) => [event.note, event.byStaff]),
      [['Please bring your own ladder.', false], ['Noted. The team brings one.', true]],
    );
    assert.deepEqual(notificationsOf(owner.id).map((notification) => notification.title), [`${request.reference}: message from building management`]);

    const cancelled = ok(await api<Record<string, any>>('POST', `/api/requests/${request.id}/cancel`, { token: owner.token }));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await api('POST', `/api/requests/${request.id}/cancel`, { token: owner.token })).status, 409);
    assert.equal((await api('POST', `/api/requests/${request.id}/comments`, { token: owner.token, body: { note: 'One more thing' } })).status, 409);
  });

  test('photos are sealed, checked, limited to four and opened only by the unit or a signed link', async () => {
    const owner = await resident('Photo Owner');
    const neighbour = await resident('Photo Neighbour');
    const unitId = await apartment('Tower D · 401', owner);
    await apartment('Tower D · 402', neighbour);
    const request = ok(await api<Record<string, any>>('POST', '/api/requests', { token: owner.token, body: leak }));

    const notImage = await api('POST', `/api/requests/${request.id}/photos`, { token: owner.token, raw: Buffer.from('%PDF-1.7 a document') });
    assert.equal(notImage.error?.field, 'file');
    let latest: Record<string, any> = request;
    for (let index = 0; index < 4; index += 1) latest = ok(await api<Record<string, any>>('POST', `/api/requests/${request.id}/photos`, { token: owner.token, raw: PNG }));
    assert.equal(latest.photos.length, 4);
    assert.equal((await api('POST', `/api/requests/${request.id}/photos`, { token: owner.token, raw: PNG })).error?.field, 'file');
    assert.equal((await api('POST', `/api/requests/${request.id}/photos`, { token: neighbour.token, raw: PNG })).status, 404);

    const link: string = latest.photos[0].url;
    const opened = await api<Buffer>('GET', link);
    assert.equal(opened.status, 200);
    assert.ok(opened.data.equals(PNG));
    const bare = link.split('?')[0];
    assert.equal((await api('GET', bare)).status, 404, 'no link, no session');
    assert.equal((await api('GET', bare, { token: neighbour.token })).status, 404, 'another unit');
    assert.equal((await api<Buffer>('GET', bare, { token: owner.token })).status, 200);
    assert.equal(photosFolder.list().length >= 4, true);

    // The unit goes: its requests go with it, and the hourly sweep removes the files.
    const before = photosFolder.list().length;
    ok(await api('DELETE', `/api/admin/units/${unitId}`, { token: ADMIN }));
    assert.equal(sweepOrphanPhotos(), 4);
    assert.equal(photosFolder.list().length, before - 4);
  });

  test('a request stays with the unit when the person who made it deletes their account', async () => {
    const owner = await resident('Staying Owner');
    const leaving = await resident('Leaving Member');
    await apartment('Tower E · 501', owner, leaving);
    const request = ok(await api<Record<string, any>>('POST', '/api/requests', { token: leaving.token, body: leak }));
    ok(await api('POST', `/api/requests/${request.id}/comments`, { token: leaving.token, body: { note: 'Door code is with the guard.' } }));
    ok(await api('POST', '/api/auth/delete-account', { token: leaving.token, body: { password: PASSWORD } }));

    const row = db().prepare('SELECT created_by FROM service_requests WHERE id = ?').get(request.id) as { created_by: string | null };
    assert.equal(row.created_by, null);
    const events = db().prepare('SELECT by_user FROM service_request_events WHERE request_id = ?').all(request.id) as { by_user: string | null }[];
    assert.ok(events.every((event) => event.by_user === null));
    const ownersView = ok(await api<Record<string, any>[]>('GET', '/api/requests', { token: owner.token }));
    assert.equal(ownersView[0].id, request.id);
    assert.equal(ownersView[0].createdByMe, false);
  });
});
