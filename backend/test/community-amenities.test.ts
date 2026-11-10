import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Phase 4 of the real backend: community (notices, alerts, events with places, polls with one vote each,
 * feedback with replies) and amenity bookings, where many residents booking the same slot at once never
 * overfill it.
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
const ADMIN = 'admin-key-for-phase-4-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-phase4-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
});

/** Monday 2 November 2026, 08:00 in Cairo (UTC+2). */
const cairo = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00+02:00`)).toISOString();
mock.timers.enable({ apis: ['Date'], now: Date.parse(cairo('2026-11-02', '08:00')) });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
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
  mock.timers.reset();
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

const PASSWORD = 'correct horse battery';
let counter = 0;
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `p4-${counter}@phase4.test`;
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

/** A resident alone in a new apartment. */
async function household(name: string) {
  const person = await resident(name);
  const unitId = await apartment(`Tower F · ${counter}`, person);
  return { ...person, unitId };
}

/** Several, made one after another (sign-up is rate limited); the test then acts for all of them at once. */
async function households(count: number, prefix: string) {
  const made: Awaited<ReturnType<typeof household>>[] = [];
  for (let index = 0; index < count; index += 1) made.push(await household(`${prefix} ${index}`));
  return made;
}

const inboxTitles = (userId: string, kind: string) =>
  (db().prepare('SELECT title FROM notifications WHERE user_id = ? AND kind = ? ORDER BY created_at, rowid').all(userId, kind) as { title: string }[]).map((row) => row.title);

describe('Community', () => {
  test('notices and alerts: published to residents, pictures from the list only, expiring takes them down', async () => {
    const reader = await household('Notice Reader');
    const empty = ok(await api<Record<string, any>>('GET', '/api/community', { token: reader.token }));
    assert.deepEqual([empty.announcements, empty.alerts, empty.events, empty.poll], [[], [], [], null]);
    const homeless = await resident('No Apartment');
    assert.equal((await api('GET', '/api/community', { token: homeless.token })).error?.code, 'no_home');

    const badPicture = await api('POST', '/api/admin/community/announcements', { token: ADMIN, body: { kind: 'news', title: 'Pool hours', body: 'New hours from Monday.', picture: 'https://example.com/x.png' } });
    assert.equal(badPicture.error?.field, 'picture');
    const news = ok(await api<Record<string, any>>('POST', '/api/admin/community/announcements', { token: ADMIN, body: { kind: 'news', title: 'Pool hours', body: 'New hours from Monday.', fullText: 'Lap lanes stay open early.', picture: 'pool' } }));
    ok(await api('POST', '/api/admin/community/announcements', { token: ADMIN, body: { kind: 'alert', level: 'warning', title: 'Water cut in Tower F', body: 'Tuesday 10:00 to 13:00.', picture: 'water' } }));
    const feed = ok(await api<Record<string, any>>('GET', '/api/community', { token: reader.token }));
    assert.deepEqual(feed.announcements.map((item: { title: string }) => item.title), ['Pool hours']);
    assert.deepEqual(feed.alerts.map((item: { title: string; level: string }) => [item.title, item.level]), [['Water cut in Tower F', 'warning']]);
    assert.equal(feed.timezone, 'Africa/Cairo');
    assert.deepEqual(inboxTitles(reader.id, 'community'), ['Pool hours', 'Alert: Water cut in Tower F']);

    ok(await api('POST', `/api/admin/community/announcements/${news.id}/expire`, { token: ADMIN }));
    assert.deepEqual(ok(await api<Record<string, any>>('GET', '/api/community', { token: reader.token })).announcements, []);
    assert.equal(ok(await api<Record<string, any>>('GET', '/api/admin/community', { token: ADMIN })).announcements.length >= 2, true, 'management still sees expired notices');
    assert.equal((await api('POST', '/api/admin/community/announcements', { token: reader.token, body: {} })).status, 403);
  });

  test('events: places counted when many register at once; soon, full and closed; changes reach those registered', async () => {
    const people = await households(3, 'Ev');
    const event = ok(await api<Record<string, any>>('POST', '/api/admin/community/events', {
      token: ADMIN,
      body: { title: 'Rooftop dinner', description: 'Bring a dish.', startsAt: cairo('2026-11-06', '19:00'), endsAt: cairo('2026-11-06', '22:00'), venue: 'Rooftop', capacity: 2, picture: 'gathering' },
    }));
    assert.equal(event.rsvp, 'open');
    const answers = await Promise.all(people.map((person) => api('POST', `/api/community/events/${event.id}/rsvp`, { token: person.token, body: { going: true } })));
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 200, 409]);
    const left = people[answers.findIndex((answer) => answer.status === 409)];
    const seenByLeft = ok(await api<Record<string, any>>('GET', '/api/community', { token: left.token })).events.find((item: { id: string }) => item.id === event.id);
    assert.deepEqual([seenByLeft.rsvp, seenByLeft.going], ['full', 2]);

    const goingPerson = people[answers.findIndex((answer) => answer.status === 200)];
    ok(await api('POST', `/api/community/events/${event.id}/rsvp`, { token: goingPerson.token, body: { going: false } }));
    assert.equal(ok(await api<Record<string, any>>('POST', `/api/community/events/${event.id}/rsvp`, { token: left.token, body: { going: true } })).rsvp, 'going');

    const later = ok(await api<Record<string, any>>('POST', '/api/admin/community/events', {
      token: ADMIN,
      body: { title: 'Kids art', description: 'Ages 5 to 12.', startsAt: cairo('2026-11-14', '10:00'), endsAt: cairo('2026-11-14', '12:00'), venue: 'Studio', rsvpOpensAt: cairo('2026-11-07', '09:00') },
    }));
    assert.equal(later.rsvp, 'soon');
    assert.equal((await api('POST', `/api/community/events/${later.id}/rsvp`, { token: left.token, body: { going: true } })).status, 409);

    ok(await api('PUT', `/api/admin/community/events/${event.id}`, { token: ADMIN, body: { venue: 'Clubhouse lounge' } }));
    ok(await api('POST', `/api/admin/community/events/${event.id}/cancel`, { token: ADMIN, body: { note: 'Rain expected.' } }));
    assert.deepEqual(inboxTitles(left.id, 'community').filter((title) => title.startsWith('Rooftop')), ['Rooftop dinner has changed', 'Rooftop dinner is cancelled']);
    assert.ok(!inboxTitles(goingPerson.id, 'community').includes('Rooftop dinner is cancelled'), 'only those still registered are told');
    assert.ok(!ok(await api<Record<string, any>>('GET', '/api/community', { token: left.token })).events.some((item: { id: string }) => item.id === event.id));
    const attendees = ok(await api<{ name: string }[]>('GET', `/api/admin/community/events/${event.id}/attendees`, { token: ADMIN }));
    assert.equal(attendees.length, 2, 'the one who left the list is not on it');
  });

  test('polls: one vote per resident, changeable until it closes; results; past polls', async () => {
    const [voterA, voterB] = await households(2, 'Voter');
    const poll = ok(await api<Record<string, any>>('POST', '/api/admin/community/polls', {
      token: ADMIN,
      body: { question: 'What should we add first?', closesAt: cairo('2026-11-09', '20:00'), options: [{ label: 'More events', picture: 'events' }, { label: 'Fitness classes', picture: 'fitness' }, 'Kids activities'] },
    }));
    const [events, fitness] = poll.options.map((option: { id: string }) => option.id);
    ok(await api('POST', `/api/community/polls/${poll.id}/vote`, { token: voterA.token, body: { optionId: events } }));
    ok(await api('POST', `/api/community/polls/${poll.id}/vote`, { token: voterA.token, body: { optionId: fitness } }));
    const afterB = ok(await api<Record<string, any>>('POST', `/api/community/polls/${poll.id}/vote`, { token: voterB.token, body: { optionId: fitness } }));
    assert.equal(afterB.totalVotes, 2, 'changing a vote does not add one');
    assert.deepEqual(afterB.options.map((option: { votes: number }) => option.votes), [0, 2, 0]);
    assert.equal(afterB.myVote, fitness);
    assert.equal((await api('POST', `/api/community/polls/${poll.id}/vote`, { token: voterB.token, body: { optionId: 'nope' } })).error?.field, 'optionId');
    assert.equal(ok(await api<Record<string, any>>('GET', '/api/community', { token: voterA.token })).poll.question, 'What should we add first?');

    ok(await api('POST', `/api/admin/community/polls/${poll.id}/close`, { token: ADMIN }));
    assert.equal((await api('POST', `/api/community/polls/${poll.id}/vote`, { token: voterA.token, body: { optionId: events } })).status, 409);
    const feed = ok(await api<Record<string, any>>('GET', '/api/community', { token: voterA.token }));
    assert.equal(feed.poll, null);
    assert.equal(feed.pastPolls[0].id, poll.id);
    assert.equal(feed.pastPolls[0].totalVotes, 2);
    assert.equal((await api('POST', '/api/admin/community/polls', { token: ADMIN, body: { question: 'One option only?', closesAt: cairo('2026-11-09', '20:00'), options: ['Yes'] } })).error?.field, 'options');
  });

  test('feedback: checked, sealed at rest, answered by management into the resident\'s inbox', async () => {
    const writer = await household('Feedback Writer');
    assert.equal((await api('POST', '/api/community/feedback', { token: writer.token, body: { topic: 'concern', message: 'Too short' } })).error?.field, 'message');
    assert.equal((await api('POST', '/api/community/feedback', { token: writer.token, body: { topic: 'rant', message: 'The lift in Tower F is slow.' } })).error?.field, 'topic');
    const sent = ok(await api<Record<string, any>>('POST', '/api/community/feedback', { token: writer.token, body: { topic: 'concern', message: 'The lift in Tower F is slow.' } }));
    const stored = db().prepare('SELECT message FROM feedback WHERE id = ?').get(sent.id) as { message: string };
    assert.ok(!stored.message.includes('lift'), 'sealed at rest');

    const queue = ok(await api<Record<string, any>[]>('GET', '/api/admin/community/feedback?status=new', { token: ADMIN }));
    const item = queue.find((row) => row.id === sent.id);
    assert.equal(item?.fromName, 'Feedback Writer');
    assert.match(item?.unitName ?? '', /^Tower F/);
    ok(await api('POST', `/api/admin/community/feedback/${sent.id}/reply`, { token: ADMIN, body: { reply: 'A technician checks it on Wednesday.' } }));
    assert.deepEqual(inboxTitles(writer.id, 'community').slice(-1), ['Building management replied to your feedback']);
    const mine = ok(await api<Record<string, any>[]>('GET', '/api/community/feedback', { token: writer.token }));
    assert.deepEqual([mine[0].status, mine[0].reply], ['answered', 'A technician checks it on Wednesday.']);
  });
});

describe('Amenities', () => {
  let pool: Record<string, any>;
  let court: Record<string, any>;

  test('management keeps the catalogue; residents see slots in the compound\'s time', async () => {
    const someone = await household('Catalogue Reader');
    assert.equal((await api('POST', '/api/admin/amenities', { token: ADMIN, body: { title: 'Pool', location: 'Club', opens: '22:00', closes: '06:00', capacity: 8, categories: ['sports'] } })).error?.field, 'closes');
    assert.equal((await api('POST', '/api/admin/amenities', { token: ADMIN, body: { title: 'Pool', location: 'Club', opens: '06:00', closes: '22:00', capacity: 8, categories: ['swimming'] } })).error?.field, 'categories');
    pool = ok(await api('POST', '/api/admin/amenities', { token: ADMIN, body: { title: 'Swimming Pool', location: 'Residential Club', opens: '06:00', closes: '22:00', capacity: 8, maxPeople: 4, categories: ['sports', 'family'], picture: 'pool' } }));
    court = ok(await api('POST', '/api/admin/amenities', { token: ADMIN, body: { title: 'Tennis Court', location: 'Sports Zone', opens: '07:00', closes: '21:00', capacity: 4, exclusive: true, categories: ['sports'], picture: 'tennis', cancelCutoffHours: 6 } }));
    ok(await api('POST', '/api/admin/amenities', { token: ADMIN, body: { title: 'Closed Hall', location: 'Tower B', opens: '09:00', closes: '22:00', capacity: 50, categories: ['leisure'], active: false } }));

    const options = ok(await api<Record<string, any>>('GET', '/api/amenities', { token: someone.token }));
    assert.deepEqual(options.amenities.map((amenity: { title: string }) => amenity.title).sort(), ['Swimming Pool', 'Tennis Court']);
    assert.deepEqual([options.firstDate, options.lastDate], ['2026-11-02', '2026-11-15']);
    const today = ok(await api<Record<string, any>[]>('GET', `/api/amenities/${pool.id}/slots?date=2026-11-02`, { token: someone.token }));
    assert.equal(today.length, 16);
    assert.deepEqual(today.filter((slot) => slot.past).map((slot) => slot.start), ['06:00', '07:00', '08:00']);
    assert.equal(today[3].left, 8);
    assert.equal((await api('GET', `/api/amenities/${pool.id}/slots?date=2026-11-16`, { token: someone.token })).error?.field, 'date');
  });

  test('bookings are checked: the day, a listed time, not past, people within the limit', async () => {
    const booker = await household('Rule Checker');
    const book = (body: Record<string, unknown>) => api('POST', `/api/amenities/${pool.id}/bookings`, { token: booker.token, body: { date: '2026-11-03', start: '10:00', people: 2, ...body } });
    assert.equal((await book({ date: '2026-11-20' })).error?.field, 'date');
    assert.equal((await book({ start: '10:30' })).error?.field, 'start');
    assert.equal((await book({ date: '2026-11-02', start: '07:00' })).error?.field, 'start');
    assert.equal((await book({ people: 5 })).error?.field, 'people');
    const made = ok(await book({}));
    assert.match(made.reference, /^BK-\d{5}$/);
    assert.deepEqual([made.date, made.start, made.end, made.people], ['2026-11-03', '10:00', '11:00', 2]);
    assert.equal((await book({ people: 1 })).error?.code, 'slot_taken', 'one apartment, one booking per slot');
    const slot = ok(await api<Record<string, any>[]>('GET', `/api/amenities/${pool.id}/slots?date=2026-11-03`, { token: booker.token })).find((entry) => entry.start === '10:00');
    assert.deepEqual([slot?.left, slot?.mine], [6, true]);
  });

  test('race: 20 apartments book the same pool slot at once; exactly the capacity gets in', async () => {
    const homes = await households(20, 'Racer');
    const answers = await Promise.all(homes.map((home) => api('POST', `/api/amenities/${pool.id}/bookings`, { token: home.token, body: { date: '2026-11-04', start: '17:00', people: 1 } })));
    assert.equal(answers.filter((answer) => answer.status === 200).length, 8);
    assert.ok(answers.filter((answer) => answer.status !== 200).every((answer) => answer.error?.code === 'slot_taken'));
    const booked = db().prepare("SELECT SUM(people) AS n FROM amenity_bookings WHERE amenity_id = ? AND starts_at = ? AND status = 'booked'").get(pool.id, cairo('2026-11-04', '17:00')) as { n: number };
    assert.equal(booked.n, 8);
  });

  test('race: 5 apartments book the same exclusive court slot at once; exactly one gets it', async () => {
    const homes = await households(5, 'Court');
    const answers = await Promise.all(homes.map((home) => api('POST', `/api/amenities/${court.id}/bookings`, { token: home.token, body: { date: '2026-11-05', start: '18:00', people: 2 } })));
    assert.equal(answers.filter((answer) => answer.status === 200).length, 1);
    // Even a write that skipped the code's checks is refused by the database itself.
    const winner = db().prepare("SELECT * FROM amenity_bookings WHERE amenity_id = ? AND status = 'booked'").get(court.id) as Record<string, unknown>;
    assert.throws(
      () => db().prepare("INSERT INTO amenity_bookings (id, amenity_id, unit_id, user_id, starts_at, ends_at, people, exclusive, status, reference, created_at, updated_at) VALUES ('x', ?, ?, NULL, ?, ?, 1, 1, 'booked', 'BK-TEST', ?, ?)")
        .run(court.id, homes[0].unitId === winner.unit_id ? homes[1].unitId : homes[0].unitId, winner.starts_at as string, winner.ends_at as string, '2026-11-02T06:00:00.000Z', '2026-11-02T06:00:00.000Z'),
      /UNIQUE constraint failed/,
    );
  });

  test('cancelling: residents until the cut-off, management with a reason; deleting an account frees its future bookings', async () => {
    const owner = await resident('Cancel Owner');
    const member = await resident('Cancel Member');
    await apartment('Tower G · 1', owner, member);
    const soon = ok(await api<Record<string, any>>('POST', `/api/amenities/${court.id}/bookings`, { token: owner.token, body: { date: '2026-11-02', start: '12:00', people: 2 } }));
    assert.equal(soon.cancellable, false, 'inside the 6-hour cut-off');
    assert.equal((await api('POST', `/api/amenities/bookings/${soon.id}/cancel`, { token: member.token })).status, 409);
    const later = ok(await api<Record<string, any>>('POST', `/api/amenities/${court.id}/bookings`, { token: owner.token, body: { date: '2026-11-07', start: '09:00', people: 2 } }));
    assert.deepEqual(inboxTitles(member.id, 'bookings'), ['Tennis Court booked', 'Tennis Court booked'], 'the rest of the apartment is told');
    assert.equal(ok(await api<Record<string, any>>('POST', `/api/amenities/bookings/${later.id}/cancel`, { token: member.token })).status, 'cancelled');

    assert.equal((await api('POST', `/api/admin/amenity-bookings/${soon.id}/cancel`, { token: ADMIN, body: {} })).error?.field, 'note');
    ok(await api('POST', `/api/admin/amenity-bookings/${soon.id}/cancel`, { token: ADMIN, body: { note: 'Court resurfacing.' } }));
    assert.ok(inboxTitles(owner.id, 'bookings').some((title) => title.includes('was cancelled')));

    const future = ok(await api<Record<string, any>>('POST', `/api/amenities/${pool.id}/bookings`, { token: member.token, body: { date: '2026-11-08', start: '11:00', people: 1 } }));
    ok(await api('POST', '/api/auth/delete-account', { token: member.token, body: { password: PASSWORD } }));
    const row = db().prepare('SELECT status, user_id FROM amenity_bookings WHERE id = ?').get(future.id) as { status: string; user_id: string | null };
    assert.deepEqual([row.status, row.user_id], ['cancelled', null]);
    const day = ok(await api<Record<string, any>>('GET', `/api/admin/amenities/${pool.id}/bookings?date=2026-11-04`, { token: ADMIN }));
    assert.equal(day.bookings.filter((booking: { status: string }) => booking.status === 'booked').length, 8);
  });
});
