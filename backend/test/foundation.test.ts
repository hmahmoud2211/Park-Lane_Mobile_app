import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

/**
 * The shared building blocks every resident feature uses: sites and their settings, server-issued references,
 * the in-app inbox (with realtime), the security role, broadcasts that stay inside a unit, and account deletion
 * of the inbox.
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
const ADMIN = 'admin-key-for-foundation-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-foundation-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
});

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { notify } = await import('../src/ems/notifications.ts');
const { publishToUnit } = await import('../src/ems/broadcast.ts');
const { yearlyReference, runningReference } = await import('../src/ems/sites.ts');
const { subscribe } = await import('../src/ems/events.ts');

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

interface Answer<T> {
  status: number;
  data: T;
  error?: { code: string; message: string; field?: string };
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
  const parsed = (await response.json()) as Record<string, any>;
  return { status: response.status, data: parsed.data as T, error: parsed.error };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

let counter = 0;
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `person${counter}@foundation.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery', name } }));
  return { token, id: user.id, email };
}

async function apartment(name: string, ...people: { email: string }[]) {
  const unit = ok(await api<{ id: string; siteId: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } }));
  for (const person of people) ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: person.email, role: 'owner' } }));
  return unit;
}

describe('sites and their settings', () => {
  test('every unit belongs to the Park Lane site, which a resident sees with its default rules', async () => {
    const mona = await resident('Mona');
    const unit = await apartment('A-101', mona);
    assert.equal(unit.siteId, 'park-lane');
    const mine = ok(await api<{ site: { id: string; kind: string; timezone: string }; settings: Record<string, any> }>('GET', '/api/sites/me', { token: mona.token }));
    assert.deepEqual(mine.site, { id: 'park-lane', name: 'Park Lane', timezone: 'Africa/Cairo', kind: 'real' });
    assert.equal(mine.settings.emergencyPhone, null);
    assert.equal(mine.settings.visitors.earliest, '08:00');
    assert.equal(mine.settings.maintenance.windows.length, 3);

    const homeless = await resident('No Home');
    const refused = await api('GET', '/api/sites/me', { token: homeless.token });
    assert.equal(refused.status, 404);
    assert.equal(refused.error?.code, 'no_home');
  });

  test('management changes the rules; bad values are refused field by field; residents may not change them', async () => {
    const saved = ok(await api<Record<string, any>>('PUT', '/api/admin/sites/park-lane/settings', { token: ADMIN, body: { emergencyPhone: '+20 2 1234 5678', visitors: { maxGuests: 6 } } }));
    assert.equal(saved.emergencyPhone, '+20 2 1234 5678');
    assert.equal(saved.visitors.maxGuests, 6);
    assert.equal(saved.visitors.earliest, '08:00');

    const badPhone = await api('PUT', '/api/admin/sites/park-lane/settings', { token: ADMIN, body: { emergencyPhone: 'call us' } });
    assert.equal(badPhone.status, 422);
    assert.equal(badPhone.error?.field, 'emergencyPhone');
    const backwards = await api('PUT', '/api/admin/sites/park-lane/settings', { token: ADMIN, body: { maintenance: { windows: [{ from: '12:00', to: '09:00' }] } } });
    assert.equal(backwards.status, 422);
    assert.equal(backwards.error?.field, 'maintenance.windows.0');

    const someone = await resident('Someone');
    assert.equal((await api('PUT', '/api/admin/sites/park-lane/settings', { token: someone.token, body: { emergencyPhone: null } })).status, 403);
    const audit = db().prepare("SELECT action FROM admin_audit WHERE target_type = 'site' AND target_id = 'park-lane'").all() as { action: string }[];
    assert.ok(audit.some((row) => row.action === 'site.settings'));
    // A malformed address is a 400, not a server error.
    assert.equal((await api('GET', '/api/admin/sites/%E0%A4%A/settings', { token: ADMIN })).status, 400);
  });
});

describe('server-issued references', () => {
  test('are sequential per site and kind, and never repeat', () => {
    const site = { id: 'park-lane', timezone: 'Africa/Cairo' };
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) seen.add(yearlyReference(site, 'test-request', 'REQ', Date.parse('2026-11-10T10:00:00Z')));
    assert.equal(seen.size, 50);
    assert.ok(seen.has('REQ-2026-00001') && seen.has('REQ-2026-00050'));
    // The year is the site's: 31 Dec 23:30 UTC is already 2027 in Cairo.
    assert.equal(yearlyReference(site, 'test-request', 'REQ', Date.parse('2026-12-31T23:30:00Z')), 'REQ-2027-00001');
    assert.equal(runningReference('park-lane', 'test-booking', 'BK'), 'BK-00001');
    assert.equal(runningReference('park-lane', 'test-booking', 'BK'), 'BK-00002');
  });
});

describe('the in-app inbox', () => {
  test('a notification arrives in realtime and in the inbox, can be read, and kinds can be turned off', async () => {
    const karim = await resident('Karim');
    const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
    const events: Record<string, any>[] = [];
    await new Promise<void>((resolve) => {
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: karim.token })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        events.push(message);
        if (message.type === 'ready') resolve();
      });
    });

    assert.equal(notify([karim.id], { kind: 'requests', title: 'Your request was assigned', body: 'A technician comes tomorrow.', ref: { type: 'service_request', id: 'r1' } }), 1);
    for (let i = 0; i < 20 && !events.some((event) => event.type === 'notification.new'); i += 1) await new Promise((r) => setTimeout(r, 25));
    const pushed = events.find((event) => event.type === 'notification.new');
    assert.equal(pushed?.notification.title, 'Your request was assigned');
    assert.equal(pushed?.unread, 1);
    socket.close();

    const page = ok(await api<{ items: { id: string; ref: unknown; readAt: string | null }[]; unread: number; next: string | null }>('GET', '/api/notifications', { token: karim.token }));
    assert.equal(page.unread, 1);
    assert.deepEqual(page.items[0].ref, { type: 'service_request', id: 'r1' });
    assert.equal(ok(await api<{ unread: number }>('POST', '/api/notifications/read', { token: karim.token, body: { ids: [page.items[0].id] } })).unread, 0);

    const prefs = ok(await api<Record<string, boolean>>('PUT', '/api/notifications/prefs', { token: karim.token, body: { community: false } }));
    assert.equal(prefs.community, false);
    assert.equal(prefs.requests, true);
    assert.equal(notify([karim.id], { kind: 'community', title: 'Pool closes early' }), 0);
    assert.equal(ok(await api<{ items: unknown[] }>('GET', '/api/notifications', { token: karim.token })).items.length, 1);
    assert.equal((await api('PUT', '/api/notifications/prefs', { token: karim.token, body: { nonsense: true } })).status, 400);
    assert.equal((await api('GET', '/api/notifications?before=yesterday', { token: karim.token })).status, 400);
  });

  test('pages run newest first, and someone else cannot read or mark another person\'s inbox', async () => {
    const owner = await resident('Owner');
    const other = await resident('Other');
    for (let index = 0; index < 5; index += 1) notify([owner.id], { kind: 'account', title: `Note ${index}` }, new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString());
    const first = ok(await api<{ items: { id: string; title: string }[]; next: string }>('GET', '/api/notifications?limit=3', { token: owner.token }));
    assert.deepEqual(first.items.map((item) => item.title), ['Note 4', 'Note 3', 'Note 2']);
    const second = ok(await api<{ items: { title: string }[]; next: string | null }>('GET', `/api/notifications?limit=3&before=${encodeURIComponent(first.next)}`, { token: owner.token }));
    assert.deepEqual(second.items.map((item) => item.title), ['Note 1', 'Note 0']);
    assert.equal(second.next, null);
    ok(await api('POST', '/api/notifications/read', { token: other.token, body: { ids: [first.items[0].id] } }));
    assert.equal(ok(await api<{ unread: number }>('GET', '/api/notifications', { token: owner.token })).unread, 5);
  });

  test('deleting the account deletes its inbox', async () => {
    const leaver = await resident('Leaver');
    notify([leaver.id], { kind: 'account', title: 'Welcome' });
    ok(await api('PUT', '/api/notifications/prefs', { token: leaver.token, body: { bills: false } }));
    ok(await api('POST', '/api/auth/delete-account', { token: leaver.token, body: { password: 'correct horse battery' } }));
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(leaver.id) as { n: number }).n, 0);
    assert.equal((db().prepare('SELECT COUNT(*) AS n FROM notification_prefs WHERE user_id = ?').get(leaver.id) as { n: number }).n, 0);
  });
});

describe('roles and broadcasts', () => {
  test('building management can create gate staff accounts with the security role', async () => {
    const created = ok(await api<{ user: { role: string }; temporaryPassword: string }>('POST', '/api/admin/users', { token: ADMIN, body: { email: 'gate1@foundation.test', name: 'Gate 1', role: 'security' } }));
    assert.equal(created.user.role, 'security');
    assert.equal(typeof created.temporaryPassword, 'string');
  });

  test('a unit broadcast reaches only the people who live there', async () => {
    const inside = await resident('Inside');
    const outside = await resident('Outside');
    const unit = await apartment('B-202', inside);
    await apartment('B-203', outside);
    const heard: string[] = [];
    const stopInside = subscribe(inside.id, () => heard.push('inside'));
    const stopOutside = subscribe(outside.id, () => heard.push('outside'));
    publishToUnit(unit.id, { type: 'test.event' });
    stopInside();
    stopOutside();
    assert.deepEqual(heard, ['inside']);
  });
});
