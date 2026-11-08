import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Sharing Health Passport records inside an apartment: a keeper shares a
 * profile with another resident to view or to edit, what each may do, the
 * ways a share ends (stopped, left, moved out, consent withdrawn), and what
 * it means for the clinic: who may book, and what the doctor may read.
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
const ADMIN = 'admin-key-for-sharing-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-sharing-')),
  ADMIN_API_KEY: ADMIN,
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  ELEVENLABS_API_KEY: '',
  CLINIC_TIMEZONE: 'Africa/Cairo',
});

/** Cairo is UTC+2 in November; the clock is Monday 2 November 2026, 08:00 there. */
const cairo = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);
mock.timers.enable({ apis: ['Date'], now: cairo('2026-11-02', '08:00') });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { createUser } = await import('../src/ems/auth.ts');
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
  error?: { code: string; message: string };
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
  if (response.status === 204) return { status: 204, data: undefined as T };
  const parsed = (await response.json()) as Record<string, any>;
  // /health answers bare bodies; /api answers { ok, data }.
  return path.startsWith('/health/')
    ? { status: response.status, data: parsed as T, error: parsed.error }
    : { status: response.status, data: parsed.data as T, error: parsed.error };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

interface Profile {
  id: string;
  name: string;
  relation: string;
  access: 'owner' | 'edit' | 'view';
  shared_by?: string;
  shared_with?: number;
}

interface Sharing {
  apartment: boolean;
  shares: { user_id: string; name: string; access: string; since: string }[];
  members: { user_id: string; name: string }[];
}

let counter = 0;

/** A resident with Health Passport switched on. */
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `resident${counter}@sharing.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery', name } }));
  ok(await api('POST', '/health/consent', { token, body: { given: true } }));
  const [self] = ok(await api<Profile[]>('GET', '/health/profiles', { token }));
  return { token, id: user.id, email, selfId: self.id };
}

type Resident = Awaited<ReturnType<typeof resident>>;

async function apartment(name: string, ...people: Resident[]): Promise<string> {
  const unitId = ok(await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } })).id;
  for (const person of people) await moveInto(unitId, person);
  return unitId;
}

async function moveInto(unitId: string, person: Resident) {
  ok(await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: person.email, role: 'owner' } }));
}

const profiles = async (person: Resident) => ok(await api<Profile[]>('GET', '/health/profiles', { token: person.token }));

async function addChild(keeper: Resident, name: string): Promise<string> {
  return ok(await api<Profile>('POST', '/health/profiles', { token: keeper.token, body: { name, relation: 'child', sex: 'female', date_of_birth: '2019-05-01', blood_type: null } })).id;
}

const share = (keeper: Resident, profileId: string, person: Resident, access: string) =>
  api<Sharing>('PUT', `/health/profiles/${profileId}/sharing/${person.id}`, { token: keeper.token, body: { access } });

const allergy = { substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' };

describe('sharing Health Passport records in an apartment', () => {
  test('a parent shares a child with the other parent, who can then keep the record too', async () => {
    const mona = await resident('Mona Ali');
    const karim = await resident('Karim Ali');
    const neighbour = await resident('Next Door');
    await apartment('Tower A · 1203', mona, karim);
    await apartment('Tower A · 1204', neighbour);
    const lina = await addChild(mona, 'Lina');

    const before = ok(await api<Sharing>('GET', `/health/profiles/${lina}/sharing`, { token: mona.token }));
    assert.deepEqual(before, { apartment: true, shares: [], members: [{ user_id: karim.id, name: 'Karim Ali' }] });

    // Only residents of the same apartment.
    assert.equal((await share(mona, lina, neighbour, 'view')).status, 404);
    assert.equal((await share(mona, lina, mona, 'view')).status, 422);
    assert.equal((await share(mona, lina, karim, 'everything')).status, 422);

    const shared = ok(await share(mona, lina, karim, 'edit'));
    assert.deepEqual(shared.shares.map((entry) => [entry.user_id, entry.name, entry.access]), [[karim.id, 'Karim Ali', 'edit']]);
    assert.deepEqual(shared.members, []);

    // Karim's list: his own record first, then Lina, marked as Mona's.
    const seen = await profiles(karim);
    assert.deepEqual(seen.map((p) => [p.name, p.relation, p.access, p.shared_by, p.shared_with]), [
      ['Karim Ali', 'self', 'owner', undefined, 0],
      ['Lina', 'child', 'edit', 'Mona Ali', undefined],
    ]);
    // Mona's list counts who sees each record she keeps; the names are on the profile's sharing page.
    assert.deepEqual((await profiles(mona)).map((p) => [p.name, p.access, p.shared_by, p.shared_with]), [
      ['Mona Ali', 'owner', undefined, 0],
      ['Lina', 'owner', undefined, 1],
    ]);

    // Karim adds an allergy and fixes her details; Mona sees both.
    const item = ok(await api<{ id: string }>('POST', `/health/profiles/${lina}/allergies`, { token: karim.token, body: allergy }));
    const updated = ok(await api<Profile>('PUT', `/health/profiles/${lina}`, { token: karim.token, body: { name: 'Lina Karim', sex: 'female', date_of_birth: '2019-05-01', blood_type: 'O+' } }));
    assert.deepEqual([updated.relation, updated.access, updated.shared_by], ['child', 'edit', 'Mona Ali']);
    const record = ok(await api<Record<string, any>>('GET', `/health/profiles/${lina}/record`, { token: mona.token }));
    assert.deepEqual(record.allergies.map((a: { id: string }) => a.id), [item.id]);
    assert.equal(record.patient.blood_type, 'O+');

    // But only Mona deletes the profile or decides who sees it.
    assert.equal((await api('DELETE', `/health/profiles/${lina}`, { token: karim.token })).status, 403);
    assert.equal((await api('GET', `/health/profiles/${lina}/sharing`, { token: karim.token })).status, 403);
    assert.equal((await share(karim, lina, karim, 'edit')).status, 403);

    // Nobody else sees it at all: 404, as if it did not exist.
    assert.equal((await api('GET', `/health/profiles/${lina}/record`, { token: neighbour.token })).status, 404);
    assert.equal((await api('POST', `/health/profiles/${lina}/allergies`, { token: neighbour.token, body: allergy })).status, 404);

    // Every change is in the audit trail, without clinical text.
    const trail = db().prepare("SELECT actor_id, action, detail FROM clinic_audit WHERE patient_profile_id = ? AND action LIKE 'passport.share%'").all(lina) as Record<string, string>[];
    assert.deepEqual(trail.map((row) => [row.actor_id, row.action, JSON.parse(row.detail)]), [[mona.id, 'passport.shared', { user_id: karim.id, access: 'edit' }]]);
  });

  test('a view-only share reads the record and prepares summaries, but changes nothing', async () => {
    const keeper = await resident('Hoda Samir');
    const reader = await resident('Omar Samir');
    await apartment('Tower B · 0101', keeper, reader);
    const item = ok(await api<{ id: string }>('POST', `/health/profiles/${keeper.selfId}/allergies`, { token: keeper.token, body: allergy }));
    ok(await share(keeper, keeper.selfId, reader, 'view'));

    const [, hers] = await profiles(reader);
    assert.deepEqual([hers.id, hers.relation, hers.access, hers.shared_by], [keeper.selfId, 'self', 'view', 'Hoda Samir']);
    const record = ok(await api<Record<string, any>>('GET', `/health/profiles/${keeper.selfId}/record`, { token: reader.token }));
    assert.equal(record.allergies.length, 1);
    assert.deepEqual(ok(await api('GET', `/health/profiles/${keeper.selfId}/documents`, { token: reader.token })), []);

    const refused = [
      await api('POST', `/health/profiles/${keeper.selfId}/allergies`, { token: reader.token, body: allergy }),
      await api('PUT', `/health/profiles/${keeper.selfId}/allergies/${item.id}`, { token: reader.token, body: allergy }),
      await api('DELETE', `/health/profiles/${keeper.selfId}/allergies/${item.id}`, { token: reader.token }),
      await api('PUT', `/health/profiles/${keeper.selfId}`, { token: reader.token, body: { name: 'Changed' } }),
      await api('DELETE', `/health/profiles/${keeper.selfId}`, { token: reader.token }),
    ];
    assert.deepEqual(refused.map((answer) => answer.status), [403, 403, 403, 403, 403]);
    assert.equal(refused[0].error?.code, 'forbidden');
    assert.equal((refused[0].data as { detail: string }).detail, 'This record was shared with you to view only.');

    // A summary reads the record without changing it: past the access check, it is this server's missing keys that stop it.
    const summary = await api('POST', `/health/profiles/${keeper.selfId}/summary`, { token: reader.token, body: { consent: true, lang: 'en' } });
    assert.equal(summary.status, 503);
    assert.equal(summary.error?.code, 'not_configured');

    // Upgraded to edit, the same request goes through.
    ok(await share(keeper, keeper.selfId, reader, 'edit'));
    ok(await api('POST', `/health/profiles/${keeper.selfId}/allergies`, { token: reader.token, body: { ...allergy, substance: 'Latex' } }));
  });

  test('a share ends when it is stopped, left, or either person leaves the apartment', async () => {
    const keeper = await resident('Sara Nabil');
    const partner = await resident('Tarek Nabil');
    const unitId = await apartment('Tower C · 0707', keeper, partner);
    const yusuf = await addChild(keeper, 'Yusuf');
    const malak = await addChild(keeper, 'Malak');
    ok(await share(keeper, yusuf, partner, 'view'));
    ok(await share(keeper, malak, partner, 'view'));

    // The keeper stops one.
    assert.equal((await api('DELETE', `/health/profiles/${yusuf}/sharing/${partner.id}`, { token: keeper.token })).status, 204);
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Tarek Nabil', 'Malak']);
    // The partner stops seeing the other; they can't end anyone else's share.
    assert.equal((await api('DELETE', `/health/profiles/${malak}/sharing/${keeper.id}`, { token: partner.token })).status, 403);
    assert.equal((await api('DELETE', `/health/profiles/${malak}/sharing/me`, { token: partner.token })).status, 204);
    assert.equal((await api('DELETE', `/health/profiles/${malak}/sharing/${partner.id}`, { token: partner.token })).status, 404);
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Tarek Nabil']);

    // Removed from the apartment: the share is gone for good, not just hidden.
    ok(await share(keeper, yusuf, partner, 'edit'));
    ok(await api('DELETE', `/api/admin/units/${unitId}/members/${partner.id}`, { token: ADMIN }));
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Tarek Nabil']);
    assert.equal((await api('GET', `/health/profiles/${yusuf}/record`, { token: partner.token })).status, 404);
    await moveInto(unitId, partner);
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Tarek Nabil']);

    // Moving the keeper to another apartment ends what they shared.
    ok(await share(keeper, yusuf, partner, 'edit'));
    const elsewhere = await apartment('Tower D · 0202');
    await moveInto(elsewhere, keeper);
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Tarek Nabil']);
    const sharing = ok(await api<Sharing>('GET', `/health/profiles/${yusuf}/sharing`, { token: keeper.token }));
    assert.deepEqual(sharing, { apartment: true, shares: [], members: [] });
  });

  test('withdrawing Health Passport consent ends the shares given and received', async () => {
    const keeper = await resident('Nour Adel');
    const partner = await resident('Ziad Adel');
    await apartment('Tower E · 0303', keeper, partner);
    const child = await addChild(keeper, 'Adam');
    ok(await share(keeper, keeper.selfId, partner, 'view'));
    ok(await share(keeper, child, partner, 'edit'));
    ok(await share(partner, partner.selfId, keeper, 'view'));

    ok(await api('POST', '/health/consent', { token: keeper.token, body: { given: false } }));
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Ziad Adel']);
    assert.equal((await api('GET', `/health/profiles/${keeper.selfId}/record`, { token: partner.token })).status, 404);
    assert.deepEqual(ok(await api<Sharing>('GET', `/health/profiles/${partner.selfId}/sharing`, { token: partner.token })).shares, []);

    // Agreeing again starts from nothing shared.
    ok(await api('POST', '/health/consent', { token: keeper.token, body: { given: true } }));
    assert.deepEqual((await profiles(keeper)).map((p) => p.name), ['Nour Adel']);
    assert.deepEqual((await profiles(partner)).map((p) => p.name), ['Ziad Adel']);
  });

  test('without an apartment there is nobody to share with', async () => {
    const alone = await resident('Alone Resident');
    assert.deepEqual(ok(await api<Sharing>('GET', `/health/profiles/${alone.selfId}/sharing`, { token: alone.token })), { apartment: false, shares: [], members: [] });
  });

  test('the other parent books the clinic for a child shared to edit, and the doctor sees the record while it stays shared', async () => {
    const mother = await resident('Rana Fouad');
    const father = await resident('Hany Fouad');
    const grandma = await resident('Grandma Fouad');
    await apartment('Tower F · 0909', mother, father, grandma);
    const child = await addChild(mother, 'Laila');
    ok(await api('POST', `/health/profiles/${child}/allergies`, { token: mother.token, body: allergy }));
    ok(await share(mother, child, father, 'edit'));
    ok(await share(mother, child, grandma, 'view'));

    // Who each can book for: an edit share counts, a view share doesn't.
    const fatherPatients = ok(await api<{ profiles: Profile[] }>('GET', '/api/clinic/patients', { token: father.token }));
    assert.deepEqual(fatherPatients.profiles.map((p) => [p.name, p.access]), [['Hany Fouad', 'owner'], ['Laila', 'edit']]);
    const grandmaPatients = ok(await api<{ profiles: Profile[] }>('GET', '/api/clinic/patients', { token: grandma.token }));
    assert.deepEqual(grandmaPatients.profiles.map((p) => p.name), ['Grandma Fouad']);

    db().prepare('INSERT OR IGNORE INTO clinic_specialties (id, name_en, name_ar, created_at) VALUES (?, ?, ?, ?)').run('pediatrics', 'Pediatrics', 'طب الأطفال', new Date().toISOString());
    const doctorEmail = `pediatrics.${randomUUID().slice(0, 6)}@clinic.test`;
    const doctorUser = await createUser(doctorEmail, 'doctor password 123', 'Dr. Salma', 'doctor');
    const doctorId = randomUUID();
    const at = new Date().toISOString();
    db()
      .prepare(
        `INSERT INTO clinic_doctors (id, user_id, specialty_id, display_name, display_name_ar, title, consultation_minutes, active, created_at, updated_at)
         VALUES (?, ?, 'pediatrics', 'Dr. Salma', 'د. سلمى', 'Consultant', 20, 1, ?, ?)`,
      )
      .run(doctorId, doctorUser.id, at, at);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      db().prepare('INSERT INTO clinic_schedules (id, doctor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), doctorId, weekday, '09:00', '13:00');
    }
    resetLimits();
    const doctorToken = ok(await api<{ token: string }>('POST', '/api/auth/login', { body: { email: doctorEmail, password: 'doctor password 123' } })).token;

    const visit = { doctor_id: doctorId, starts_at: new Date(cairo('2026-11-02', '10:00')).toISOString(), patient_profile_id: child, reason: 'Cough', share_history: true, ai_consent: false };
    const refused = await api('POST', '/api/clinic/appointments', { token: grandma.token, body: visit });
    assert.equal(refused.status, 403);
    const booked = ok(await api<{ id: string; patient: { profile_id: string; name: string } }>('POST', '/api/clinic/appointments', { token: father.token, body: visit }));
    assert.deepEqual(booked.patient, { profile_id: child, name: 'Laila' });

    const history = async () => ok(await api<Record<string, any>>('GET', `/api/clinic/doctor/appointments/${booked.id}/history`, { token: doctorToken }));
    assert.equal((await history()).access.level, 'full');

    // Downgraded to view, the father can no longer hand the record to a doctor.
    ok(await share(mother, child, father, 'view'));
    const limited = await history();
    assert.deepEqual(limited.access, { level: 'limited', reason: 'The family member who booked this visit can no longer change this Health Passport.' });
  });
});
