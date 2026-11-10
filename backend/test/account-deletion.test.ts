import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Deleting one's own account (POST /api/auth/delete-account), as App Store 5.1.1(v) and Google
 * Play require: the password is checked, every sign-in ends (live sockets too), the apartment,
 * Health Passport data and files go, upcoming clinic visits are cancelled, the clinic's record of
 * past visits stays with an anonymous account row, and the shared demo account is protected.
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
const ADMIN = 'admin-key-for-deletion-tests';
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ems-deletion-'));

Object.assign(process.env, {
  DATA_DIR,
  ADMIN_API_KEY: ADMIN,
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  ELEVENLABS_API_KEY: '',
  CLINIC_TIMEZONE: 'Africa/Cairo',
  EMS_DEFAULT_USERNAME: 'ems',
  EMS_DEFAULT_PASSWORD: '5002',
});

/** Cairo is UTC+2 in November; the clock is Monday 2 November 2026, 08:00 there. */
const cairo = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);
mock.timers.enable({ apis: ['Date'], now: cairo('2026-11-02', '08:00') });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { createUser, ensureDefaultAccount } = await import('../src/ems/auth.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

let server: Server;

before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
  await ensureDefaultAccount();
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
  return path.startsWith('/health/')
    ? { status: response.status, data: parsed as T, error: parsed.error }
    : { status: response.status, data: parsed.data as T, error: parsed.error };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

const PASSWORD = 'correct horse battery';
let counter = 0;

/** A resident with Health Passport on, living in an apartment of their own. */
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `resident${counter}@deletion.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: PASSWORD, name } }));
  ok(await api('POST', '/health/consent', { token, body: { given: true } }));
  const [self] = ok(await api<{ id: string }[]>('GET', '/health/profiles', { token }));
  return { token, id: user.id, email, selfId: self.id };
}

type Resident = Awaited<ReturnType<typeof resident>>;

async function apartment(name: string, ...people: Resident[]): Promise<string> {
  const unitId = ok(await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } })).id;
  for (const person of people) {
    ok(await api('POST', `/api/admin/units/${unitId}/members`, { token: ADMIN, body: { email: person.email, role: 'owner' } }));
  }
  return unitId;
}

const count = (sql: string, ...params: string[]) => (db().prepare(sql).get(...params) as { n: number }).n;

async function doctor() {
  db().prepare('INSERT OR IGNORE INTO clinic_specialties (id, name_en, name_ar, created_at) VALUES (?, ?, ?, ?)').run('pediatrics', 'Pediatrics', 'طب الأطفال', new Date().toISOString());
  const email = `doctor.${randomUUID().slice(0, 6)}@clinic.test`;
  const user = await createUser(email, 'doctor password 123', 'Dr. Salma', 'doctor');
  const id = randomUUID();
  const at = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO clinic_doctors (id, user_id, specialty_id, display_name, display_name_ar, title, consultation_minutes, active, created_at, updated_at)
       VALUES (?, ?, 'pediatrics', 'Dr. Salma', 'د. سلمى', 'Consultant', 20, 1, ?, ?)`,
    )
    .run(id, user.id, at, at);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    db().prepare('INSERT INTO clinic_schedules (id, doctor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, weekday, '09:00', '13:00');
  }
  resetLimits();
  const token = ok(await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'doctor password 123' } })).token;
  return { id, token };
}

describe('deleting your own account', () => {
  test('a wrong password deletes nothing', async () => {
    const person = await resident('Wrong Password');
    const refused = await api('POST', '/api/auth/delete-account', { token: person.token, body: { password: 'not it' } });
    assert.equal(refused.status, 401);
    ok(await api('GET', '/api/auth/me', { token: person.token }));
    assert.equal(count('SELECT COUNT(*) AS n FROM health_profiles WHERE owner_id = ?', person.id), 1);
  });

  test('everything the account holds goes, and the email can be used again', async () => {
    const mona = await resident('Mona Ali');
    const karim = await resident('Karim Ali');
    await apartment('Tower A · 1203', mona, karim);
    const child = ok(await api<{ id: string }>('POST', '/health/profiles', { token: mona.token, body: { name: 'Lina', relation: 'child', sex: 'female', date_of_birth: '2019-05-01', blood_type: null } })).id;
    ok(await api('POST', `/health/profiles/${child}/allergies`, { token: mona.token, body: { substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' } }));
    ok(await api('PUT', `/health/profiles/${child}/sharing/${karim.id}`, { token: mona.token, body: { access: 'view' } }));
    ok(await api('PUT', `/health/profiles/${karim.selfId}/sharing/${mona.id}`, { token: karim.token, body: { access: 'view' } }));

    // A page left on disk by a document, as Health Passport stores them; no row names it once the account is gone.
    const files = join(DATA_DIR, 'health', 'files');
    mkdirSync(files, { recursive: true });
    const orphan = join(files, randomUUID());
    writeFileSync(orphan, 'sealed page');

    const answer = ok(await api<{ deleted: boolean; clinicRecordsKept: boolean }>('POST', '/api/auth/delete-account', { token: mona.token, body: { password: PASSWORD } }));
    assert.deepEqual(answer, { deleted: true, clinicRecordsKept: false });

    assert.equal((await api('GET', '/api/auth/me', { token: mona.token })).status, 401);
    resetLimits();
    assert.equal((await api('POST', '/api/auth/login', { body: { email: mona.email, password: PASSWORD } })).status, 401);
    assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', mona.id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM tokens WHERE user_id = ?', mona.id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM health_profiles WHERE owner_id = ?', mona.id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM health_items WHERE profile_id = ?', child), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM health_consents WHERE user_id = ?', mona.id), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM health_shares WHERE user_id = ? OR profile_id = ?', mona.id, child), 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM unit_members WHERE user_id = ?', mona.id), 0);
    assert.equal(existsSync(orphan), false);

    // Karim keeps his own record and his apartment; what Mona shared with him is gone.
    const karimProfiles = ok(await api<{ id: string }[]>('GET', '/health/profiles', { token: karim.token }));
    assert.deepEqual(karimProfiles.map((profile) => profile.id), [karim.selfId]);
    assert.equal(count('SELECT COUNT(*) AS n FROM unit_members WHERE user_id = ?', karim.id), 1);

    resetLimits();
    ok(await api('POST', '/api/auth/register', { body: { email: mona.email, password: PASSWORD, name: 'Mona again' } }));
  });

  test('upcoming visits are cancelled and the clinic keeps past ones, with no name on the account', async () => {
    const clinic = await doctor();
    const patient = await resident('Hany Fouad');
    const book = async (time: string) =>
      ok(
        await api<{ id: string }>('POST', '/api/clinic/appointments', {
          token: patient.token,
          body: { doctor_id: clinic.id, starts_at: new Date(cairo('2026-11-02', time)).toISOString(), patient_profile_id: patient.selfId, reason: 'Cough', share_history: false, ai_consent: false },
        }),
      ).id;
    const past = await book('09:00');
    const upcoming = await book('11:00');
    // The 09:00 visit happened.
    db().prepare("UPDATE clinic_appointments SET status = 'completed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), past);

    const answer = ok(await api<{ clinicRecordsKept: boolean }>('POST', '/api/auth/delete-account', { token: patient.token, body: { password: PASSWORD } }));
    assert.equal(answer.clinicRecordsKept, true);

    const rows = db().prepare('SELECT id, status, booked_by, patient_name, patient_profile_id FROM clinic_appointments WHERE id IN (?, ?) ORDER BY starts_at').all(past, upcoming) as Record<string, string | null>[];
    assert.deepEqual(rows.map((row) => [row.id, row.status]), [[past, 'completed'], [upcoming, 'cancelled']]);
    assert.ok(rows.every((row) => row.booked_by === patient.id && row.patient_profile_id === null && row.patient_name === 'Hany Fouad'));

    const account = db().prepare('SELECT email, name, password_hash FROM users WHERE id = ?').get(patient.id) as Record<string, string>;
    assert.match(account.email, /^deleted-[0-9a-f-]+@deleted\.invalid$/);
    assert.equal(account.name, 'Deleted account');
    resetLimits();
    assert.equal((await api('POST', '/api/auth/login', { body: { email: patient.email, password: PASSWORD } })).status, 401);
    // The doctor still sees the past visit in the day's list.
    const day = ok(await api<Record<string, any>>('GET', '/api/clinic/doctor/appointments?date=2026-11-02', { token: clinic.token }));
    assert.ok(JSON.stringify(day).includes(past));
  });

  test('the shared demo account and staff accounts cannot be deleted', async () => {
    resetLimits();
    const demo = ok(await api<{ token: string }>('POST', '/api/auth/login', { body: { email: 'ems', password: '5002' } })).token;
    assert.equal((await api('POST', '/api/auth/delete-account', { token: demo, body: { password: '5002' } })).status, 403);
    // Nobody can lock the next person out of it either.
    assert.equal((await api('POST', '/api/auth/change-password', { token: demo, body: { currentPassword: '5002', newPassword: 'something much longer' } })).status, 403);
    assert.equal((await api('POST', '/api/auth/logout-others', { token: demo })).status, 403);
    ok(await api('GET', '/api/auth/me', { token: demo }));

    const clinic = await doctor();
    assert.equal((await api('POST', '/api/auth/delete-account', { token: clinic.token, body: { password: 'doctor password 123' } })).status, 403);
  });

  test('a live connection ends as soon as the account is deleted', async () => {
    const person = await resident('Socket User');
    const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
    const messages: string[] = [];
    const closed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)));
    await new Promise<void>((resolve) => {
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: person.token })));
      socket.addEventListener('message', (event) => {
        messages.push(String(event.data));
        if (String(event.data).includes('ready')) resolve();
      });
    });
    ok(await api('POST', '/api/auth/delete-account', { token: person.token, body: { password: PASSWORD } }));
    assert.equal(await closed, 4401);
    assert.ok(messages.some((message) => message.includes('unauthorized')));
  });
});

describe('the public pages the store listings link to', () => {
  test('the privacy policy and the deletion page are served, locked down, and say when they are a draft', async () => {
    for (const path of ['/privacy', '/account/delete', '/public/delete.js', '/public/page.css']) {
      const response = await fetch(`${BASE}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'self'/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    const policy = await (await fetch(`${BASE}/privacy`)).text();
    // LEGAL_OPERATOR_NAME and LEGAL_CONTACT_EMAIL are not set in this test.
    assert.match(policy, /Draft: the operator/);
    assert.match(policy, /Google Gemini or Anthropic Claude/);
    assert.match(policy, /ElevenLabs/);
    assert.match(policy, /href="\/account\/delete"/);
    assert.doesNotMatch(policy, /\{\{/);
    const page = await (await fetch(`${BASE}/account/delete`)).text();
    assert.match(page, /<script src="\/public\/delete\.js" defer><\/script>/);
    assert.equal((await fetch(`${BASE}/privacy`, { method: 'POST' })).status, 404);
  });
});
