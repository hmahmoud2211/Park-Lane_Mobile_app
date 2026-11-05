import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, mock, test } from 'node:test';

/**
 * The clinic and Health Passport, end to end over HTTP and WebSocket:
 * booking and double-booking, the status machine and who may drive it, the
 * queue and next-patient notices, history access, AI summaries and notes,
 * speech, finalizing into Health Passport, and retention.
 *
 * Claude and ElevenLabs are stand-ins on localhost that answer like the
 * real APIs, so the tests check what is sent to them as well as what the
 * clinic does with the answers. The clinic's clock is mocked (Date only),
 * starting Monday 2 November 2026, 09:00 in Cairo.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const aiPort = await freePort();
const voicePort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-clinic-')),
  // This suite exercises the Claude provider; health-ai.test.ts exercises Gemini.
  AI_PROVIDER: 'anthropic',
  GEMINI_API_KEY: '',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`,
  ELEVENLABS_API_KEY: 'test-eleven-key',
  ELEVENLABS_BASE_URL: `http://127.0.0.1:${voicePort}`,
  CLINIC_TIMEZONE: 'Africa/Cairo',
});

/** Cairo is UTC+2 in November. */
const cairo = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);
const TODAY = '2026-11-02';
const TOMORROW = '2026-11-03';
const iso = (date: string, time: string) => new Date(cairo(date, time)).toISOString();

mock.timers.enable({ apis: ['Date'], now: cairo(TODAY, '09:00') });
const setClock = (date: string, time: string) => mock.timers.setTime(cairo(date, time));

const { createApp } = await import('../src/app.ts');
const { closeDb, db } = await import('../src/ems/db.ts');
const { createUser } = await import('../src/ems/auth.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { purgeExpiredContent } = await import('../src/clinic/consultations.ts');
const { speechParts } = await import('../src/clinic/speech.ts');
const { CLOSING } = await import('../src/health/spoken.ts');

// ---- Stand-ins for Claude and ElevenLabs ----------------------------------------------------

const TRANSCRIPT =
  'How long have you had the chest tightness? About two weeks, when I climb the stairs. ' +
  'Your blood pressure is 150 over 95. This is likely stable angina. ' +
  'I will start aspirin 75 once a day for a month, and we will do an ECG.';

const ai = {
  mode: 'ok' as 'ok' | 'error' | 'refusal',
  calls: [] as { headers: IncomingMessage['headers']; body: Record<string, unknown> }[],
};

const historyReply = {
  overview: { text: 'Documented type 2 diabetes on metformin, with a severe penicillin allergy.', sources: ['P1', 'P2', 'P3'] },
  relevant_history: [
    { text: 'Type 2 diabetes, diagnosed May 2019, active.', sources: ['P3'] },
    { text: 'A heart attack in 2015.', sources: ['P999'] },
  ],
  medications: [{ text: 'Metformin 500 mg twice daily since June 2019.', sources: ['P2'], status: 'current' }],
  allergies: [{ text: 'Penicillin: rash and swelling, severe.', sources: ['P1'] }],
  previous_consultations: [],
  considerations: [
    { text: 'Severe penicillin allergy: check before prescribing antibiotics.', sources: ['P1'] },
    { text: 'Probably needs a statin.', sources: [] },
  ],
  missing_information: ['No recent lipid profile.'],
};

const noteReply = {
  note: {
    chief_complaint: 'Chest tightness on exertion',
    history: 'Two weeks of chest tightness when climbing stairs.',
    symptoms: ['Chest tightness on exertion'],
    symptom_duration: 'Two weeks',
    reported_history: '',
    examination: 'Blood pressure 150/95.',
    vitals: [{ name: 'Blood pressure', value: '150/95' }],
    assessment: 'Likely stable angina.',
    diagnoses: [{ name: 'Stable angina', certainty: 'provisional' }],
    plan: 'Start aspirin and arrange an ECG.',
    medications: [{ name: 'Aspirin', dose: '75 mg', frequency: 'once daily', duration_days: 30, route: 'oral', instructions: '' }],
    investigations: ['ECG', 'Lipid profile'],
    follow_up: { needed: true, in_days: 14, instructions: 'Review the ECG.' },
    patient_instructions: 'Take aspirin 75 mg once a day for a month. Come back for your ECG.',
  },
  evidence: [
    { field: 'vitals[0]', quote: 'blood pressure is 150 over 95' },
    { field: 'examination', quote: 'blood pressure is 150 over 95' },
    { field: 'diagnoses[0]', quote: 'likely stable angina' },
    { field: 'medications[0]', quote: 'start aspirin 75 once a day for a month' },
    { field: 'investigations[0]', quote: 'we will do an ECG' },
    { field: 'assessment', quote: 'the troponin was normal' },
    { field: 'plan', quote: 'start aspirin 75' },
  ],
  review_flags: [{ field: 'medications[0].route', message: 'Route not stated; assumed oral.' }],
};

/** The spoken handover for the full-flow patient's record: passes the automatic check. */
const SPOKEN_SCRIPT =
  'Patient is 58 years old and male. Important, he has a severe allergy to Penicillin, which causes rash and swelling. ' +
  'He takes Metformin 500 milligrams twice daily, started in June 2019. He has Type 2 diabetes, diagnosed in May 2019, and it is active. ' +
  'His blood type is not recorded. There are no lab results from the last 12 months in the record. ' +
  'Nothing else is documented about procedures or recent visits in this record.';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const aiServer: Server = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString('utf8')) as Record<string, unknown>;
  ai.calls.push({ headers: req.headers, body });
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (req.url !== '/v1/messages' || req.headers['x-api-key'] !== 'test-anthropic-key') {
    return json(401, { type: 'error', error: { type: 'authentication_error' } });
  }
  if (ai.mode === 'error') return json(500, { type: 'error', error: { type: 'api_error' } });
  if (ai.mode === 'refusal') return json(200, { model: 'claude-opus-5-5', stop_reason: 'refusal', content: [] });
  const system = String(body.system);
  const text = system.includes('spoken handover') ? SPOKEN_SCRIPT : JSON.stringify(system.includes('SOAP') ? noteReply : historyReply);
  return json(200, {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 300 },
  });
});

const voice = { stt: 0, tts: [] as string[] };

const voiceServer: Server = createServer(async (req, res) => {
  const raw = await readBody(req);
  if (req.headers['xi-api-key'] !== 'test-eleven-key') {
    res.writeHead(401).end();
    return;
  }
  if (req.url?.startsWith('/v1/text-to-speech/')) {
    voice.tts.push((JSON.parse(raw.toString('utf8')) as { text: string }).text);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(Buffer.from('ID3-fake-mp3-audio'));
    return;
  }
  if (req.url?.startsWith('/v1/speech-to-text')) {
    voice.stt += 1;
    assert.match(String(req.headers['content-type']), /^multipart\/form-data/);
    const [doctorLine, patientLine] = [TRANSCRIPT.slice(0, 43), TRANSCRIPT.slice(43)];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        language_code: 'en',
        language_probability: 0.98,
        text: TRANSCRIPT,
        words: [
          { text: doctorLine, type: 'word', speaker_id: 'speaker_0' },
          { text: ' ', type: 'spacing', speaker_id: 'speaker_0' },
          { text: patientLine, type: 'word', speaker_id: 'speaker_1' },
        ],
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

// ---- Helpers ------------------------------------------------------------------------------

interface Envelope<T> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function api<T = Record<string, any>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; raw?: Buffer; contentType?: string; lang?: string } = {},
): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.raw ? { 'Content-Type': options.contentType ?? 'audio/webm' } : {}),
      ...(options.lang ? { 'Accept-Language': options.lang } : {}),
    },
    body: options.raw ? new Uint8Array(options.raw) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return { status: 204, ok: true, data: undefined as T };
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    return { status: response.status, ok: response.ok, data: Buffer.from(await response.arrayBuffer()) as T };
  }
  const parsed = (await response.json()) as Record<string, unknown>;
  // /health answers bare bodies; /api answers { ok, data }.
  if (path.startsWith('/health/')) {
    return { status: response.status, ok: response.ok, data: parsed as T, error: parsed.error as Envelope<T>['error'] };
  }
  return { status: response.status, ...(parsed as { ok: boolean; data: T; error?: Envelope<T>['error'] }) };
}

const expectOk = <T>(result: Envelope<T>): T => {
  assert.ok(result.ok, `${result.status} ${JSON.stringify(result.error)}`);
  return result.data;
};

let counter = 0;
async function resident(options: { passport?: boolean } = { passport: true }) {
  counter += 1;
  // Many accounts sign up here under a frozen clock; the per-IP auth limit is tested elsewhere.
  resetLimits();
  const result = await api<{ token: string; user: { id: string; role: string } }>('POST', '/api/auth/register', {
    body: { email: `patient${counter}@example.com`, password: 'correct horse battery', name: `Patient Number ${counter}` },
  });
  const { token, user } = expectOk(result);
  assert.equal(user.role, 'resident');
  let profileId = '';
  if (options.passport) {
    expectOk(await api('POST', '/health/consent', { token, body: { given: true } }));
    const profiles = expectOk(await api<{ id: string; relation: string }[]>('GET', '/health/profiles', { token }));
    profileId = profiles[0].id;
    expectOk(await api('PUT', `/health/profiles/${profileId}`, { token, body: { name: `Patient Number ${counter}`, sex: 'male', date_of_birth: '1968-03-14', blood_type: null } }));
  }
  return { token, userId: user.id, profileId };
}

async function signIn(email: string, password: string) {
  resetLimits();
  return expectOk(await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password } })).token;
}

function addSpecialty(id: string, en: string, ar: string) {
  db().prepare('INSERT OR IGNORE INTO clinic_specialties (id, name_en, name_ar, created_at) VALUES (?, ?, ?, ?)').run(id, en, ar, new Date().toISOString());
}

/** A doctor working 09:00-13:00 every day, in 20-minute consultations. */
async function addDoctor(name: string, specialty: string, nameAr = name) {
  const email = `${specialty}.${randomUUID().slice(0, 6)}@clinic.test`;
  const user = await createUser(email, 'doctor password 123', name, 'doctor');
  const id = randomUUID();
  const at = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO clinic_doctors (id, user_id, specialty_id, display_name, display_name_ar, title, consultation_minutes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Consultant', 20, 1, ?, ?)`,
    )
    .run(id, user.id, specialty, name, nameAr, at, at);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    db().prepare('INSERT INTO clinic_schedules (id, doctor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, weekday, '09:00', '13:00');
  }
  return { id, userId: user.id, email, token: await signIn(email, 'doctor password 123') };
}

async function desk() {
  const email = `desk.${randomUUID().slice(0, 6)}@clinic.test`;
  await createUser(email, 'desk password 123', 'Front Desk', 'clinic_staff');
  return signIn(email, 'desk password 123');
}

function book(token: string, doctorId: string, startsAt: string, profileId: string, extra: Record<string, unknown> = {}) {
  return api<Record<string, any>>('POST', '/api/clinic/appointments', {
    token,
    body: { doctor_id: doctorId, starts_at: startsAt, patient_profile_id: profileId, reason: 'Chest tightness', ...extra },
  });
}

const status = (token: string, id: string, action: string, prefix = '/api/clinic/doctor') =>
  api<Record<string, any>>('POST', `${prefix}/appointments/${id}/status`, { token, body: { action } });

/** A realtime session; waits are counted in polls, since the clinic's clock is mocked. */
async function listen(token: string) {
  const events: Record<string, any>[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
  socket.addEventListener('message', (event) => events.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket error')));
  });
  socket.send(JSON.stringify({ type: 'auth', token }));
  const waitFor = async (match: (event: Record<string, any>) => boolean) => {
    for (let poll = 0; poll < 100; poll += 1) {
      const found = events.find(match);
      if (found) return found;
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`event not received: ${JSON.stringify(events)}`);
  };
  await waitFor((event) => event.type === 'ready');
  return { socket, events, waitFor };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

// ---- Lifecycle ----------------------------------------------------------------------------

let server: Server;

before(async () => {
  await new Promise<void>((resolve) => aiServer.listen(aiPort, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => voiceServer.listen(voicePort, '127.0.0.1', resolve));
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
  addSpecialty('cardiology', 'Cardiology', 'أمراض القلب');
  addSpecialty('pediatrics', 'Pediatrics', 'طب الأطفال');
  addSpecialty('dermatology', 'Dermatology', 'الأمراض الجلدية');
});

after(async () => {
  closeRealtimeConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => aiServer.close(resolve));
  await new Promise((resolve) => voiceServer.close(resolve));
  closeDb();
  mock.timers.reset();
});

// ---- Tests --------------------------------------------------------------------------------

describe('Health Passport API', () => {
  test('needs consent, validates items field by field, and computes gaps in the request language', async () => {
    const { token } = await resident({ passport: false });
    const refused = await api('GET', '/health/profiles', { token });
    assert.equal(refused.status, 422);

    expectOk(await api('POST', '/health/consent', { token, body: { given: true } }));
    const [self] = expectOk(await api<{ id: string; relation: string; name: string }[]>('GET', '/health/profiles', { token }));
    assert.equal(self.relation, 'self');

    const bad = await api<{ detail: string }>('POST', `/health/profiles/${self.id}/labs`, { token, body: { test: 'HbA1c', value: 'high', date: '2026-08-19' } });
    assert.equal(bad.status, 422);
    assert.equal(bad.data.detail, 'value');

    const allergy = expectOk(await api<{ id: string; source: null }>('POST', `/health/profiles/${self.id}/allergies`, { token, body: { substance: 'Penicillin', reaction: 'rash', severity: 'severe' } }));
    assert.equal(allergy.source, null);

    const record = expectOk(await api<{ allergies: unknown[]; gaps: { kind: string; text: string }[]; consultations: unknown[] }>('GET', `/health/profiles/${self.id}/record`, { token, lang: 'ar' }));
    assert.equal(record.allergies.length, 1);
    assert.deepEqual(record.gaps.map((gap) => gap.kind).sort(), ['missing_blood_type', 'no_recent_labs']);
    assert.equal(record.gaps[0].text, 'فصيلة الدم غير مسجلة.');
    assert.deepEqual(record.consultations, []);

    // Stored sealed: the substance never appears in the database in clear.
    const raw = db().prepare('SELECT data FROM health_items WHERE id = ?').get(allergy.id) as { data: string };
    assert.ok(!raw.data.includes('Penicillin'));

    const other = await resident();
    assert.equal((await api('GET', `/health/profiles/${self.id}/record`, { token: other.token })).status, 404);
    const notAnUpload = await api<{ detail: string }>('POST', `/health/profiles/${self.id}/documents`, { token, body: {} });
    assert.equal(notAnUpload.status, 422);
    assert.equal(notAnUpload.data.detail, 'files');
  });
});

describe('clinic directory and booking', () => {
  let cardio: Awaited<ReturnType<typeof addDoctor>>;

  before(async () => {
    cardio = await addDoctor('Dr. Karim Hassan', 'cardiology', 'د. كريم حسن');
    await addDoctor('Dr. Salma Fathy', 'pediatrics');
  });

  test('specialties come from the doctors there are, and search covers both languages', async () => {
    const { token } = await resident();
    const specialties = expectOk(await api<{ id: string; doctor_count: number }[]>('GET', '/api/clinic/specialties', { token }));
    assert.ok(specialties.some((entry) => entry.id === 'cardiology'));
    assert.ok(!specialties.some((entry) => entry.id === 'dermatology'), 'a specialty without doctors is not offered');

    const filtered = expectOk(await api<{ id: string; specialty: { id: string } }[]>('GET', '/api/clinic/doctors?specialty=cardiology', { token }));
    assert.ok(filtered.length > 0 && filtered.every((doctor) => doctor.specialty.id === 'cardiology'));
    assert.ok(filtered.some((doctor) => doctor.id === cardio.id));
    const byArabic = expectOk(await api<{ id: string }[]>(`GET`, `/api/clinic/doctors?q=${encodeURIComponent('كريم')}`, { token }));
    assert.deepEqual(byArabic.map((doctor) => doctor.id), [cardio.id]);
    const bySpecialty = expectOk(await api<{ id: string }[]>('GET', '/api/clinic/doctors?q=pediatr', { token }));
    assert.equal(bySpecialty.length, 1);
  });

  test('slots follow the schedule and booking lead time, and a booked slot shows as booked', async () => {
    const patient = await resident();
    const day = expectOk(await api<{ slots: { time: string; state: string; starts_at: string }[] }>('GET', `/api/clinic/doctors/${cardio.id}/slots?date=${TODAY}`, { token: patient.token }));
    assert.equal(day.slots.length, 12);
    assert.equal(day.slots[0].state, 'past', '09:00 is before the 30-minute lead time');
    assert.equal(day.slots.find((slot) => slot.time === '09:40')?.state, 'available');

    expectOk(await book(patient.token, cardio.id, iso(TOMORROW, '11:00'), patient.profileId));
    const tomorrow = expectOk(await api<{ slots: { time: string; state: string }[] }>('GET', `/api/clinic/doctors/${cardio.id}/slots?date=${TOMORROW}`, { token: patient.token }));
    assert.equal(tomorrow.slots.find((slot) => slot.time === '11:00')?.state, 'booked');

    const offGrid = await book(patient.token, cardio.id, iso(TOMORROW, '11:05'), patient.profileId);
    assert.equal(offGrid.status, 422);
  });

  test('two residents racing for one slot: exactly one gets it', async () => {
    const [a, b] = [await resident(), await resident()];
    const results = await Promise.all([
      book(a.token, cardio.id, iso(TOMORROW, '12:00'), a.profileId),
      book(b.token, cardio.id, iso(TOMORROW, '12:00'), b.profileId),
    ]);
    assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
    assert.equal(results.find((result) => !result.ok)?.error?.code, 'slot_taken');
    const live = db().prepare("SELECT COUNT(*) AS count FROM clinic_appointments WHERE doctor_id = ? AND starts_at = ? AND status = 'scheduled'").get(cardio.id, iso(TOMORROW, '12:00')) as { count: number };
    assert.equal(live.count, 1);
  });

  test('the same patient cannot be booked twice at once, even with another doctor; others cannot book for them', async () => {
    const patient = await resident();
    const other = await addDoctor('Dr. Other', 'cardiology');
    expectOk(await book(patient.token, cardio.id, iso(TOMORROW, '10:00'), patient.profileId));
    const clash = await book(patient.token, other.id, iso(TOMORROW, '10:00'), patient.profileId);
    assert.equal(clash.error?.code, 'slot_taken');
    const stranger = await resident();
    const forSomeoneElse = await book(stranger.token, cardio.id, iso(TOMORROW, '10:40'), patient.profileId);
    assert.equal(forSomeoneElse.status, 404);
    const noPassport = await resident({ passport: false });
    assert.equal((await book(noPassport.token, cardio.id, iso(TOMORROW, '10:40'), 'x')).error?.code, 'consent_required');
  });

  test('a resident cancels or reschedules an upcoming visit, which frees the slot', async () => {
    const patient = await resident();
    const first = expectOk(await book(patient.token, cardio.id, iso(TOMORROW, '09:20'), patient.profileId));
    const moved = expectOk(await book(patient.token, cardio.id, iso(TOMORROW, '09:40'), patient.profileId, { reschedule_of: first.id }));
    const old = expectOk(await api<{ status: string; rescheduled_to: string }>('GET', `/api/clinic/me/appointments/${first.id}`, { token: patient.token }));
    assert.equal(old.status, 'rescheduled');
    assert.equal(old.rescheduled_to, moved.id);
    const cancelled = expectOk(await api<{ status: string }>('POST', `/api/clinic/me/appointments/${moved.id}/cancel`, { token: patient.token, body: {} }));
    assert.equal(cancelled.status, 'cancelled');
    const someone = await resident();
    expectOk(await book(someone.token, cardio.id, iso(TOMORROW, '09:20'), someone.profileId));
    expectOk(await book(someone.token, cardio.id, iso(TOMORROW, '09:40'), someone.profileId));
  });
});

describe('roles, the status machine and the queue', () => {
  let doctor: Awaited<ReturnType<typeof addDoctor>>;
  let otherDoctor: Awaited<ReturnType<typeof addDoctor>>;
  let deskToken: string;

  before(async () => {
    doctor = await addDoctor('Dr. Queue Test', 'cardiology');
    otherDoctor = await addDoctor('Dr. Somebody Else', 'cardiology');
    deskToken = await desk();
  });

  test('every role sees only its own part of the clinic', async () => {
    setClock(TODAY, '09:00');
    const patient = await resident();
    const appointment = expectOk(await book(patient.token, doctor.id, iso(TODAY, '10:00'), patient.profileId));

    assert.equal((await api('GET', '/api/clinic/doctor/dashboard', { token: patient.token })).status, 403);
    assert.equal((await api('GET', `/api/clinic/doctor/appointments/${appointment.id}`, { token: otherDoctor.token })).status, 404);
    assert.equal((await api('GET', `/api/clinic/doctor/appointments/${appointment.id}/history`, { token: otherDoctor.token })).status, 404);
    assert.equal((await api('GET', `/api/clinic/me/appointments/${appointment.id}`, { token: (await resident()).token })).status, 404);
    assert.equal((await api('GET', '/api/clinic/desk/day', { token: doctor.token })).status, 403);
    // The desk may check a patient in but never start a consultation or read history.
    assert.equal((await status(deskToken, appointment.id, 'start', '/api/clinic/desk')).status, 403);
    assert.equal((await api('GET', `/api/clinic/doctor/appointments/${appointment.id}/history`, { token: deskToken })).status, 403);
    // Nobody signs up as a doctor.
    const signup = expectOk(await api<{ user: { role: string } }>('POST', '/api/auth/register', { body: { email: 'sneaky@example.com', password: 'password 1234', name: 'Dr. Sneaky', role: 'doctor' } }));
    assert.equal(signup.user.role, 'resident');
  });

  test('moves are checked: no consultation before check-in, no no-show before the slot, no check-in on another day', async () => {
    setClock(TODAY, '09:00');
    const patient = await resident();
    const appointment = expectOk(await book(patient.token, doctor.id, iso(TODAY, '11:00'), patient.profileId));
    assert.equal((await status(doctor.token, appointment.id, 'start')).error?.code, 'invalid_transition');
    assert.equal((await api('POST', `/api/clinic/doctor/appointments/${appointment.id}/consultation`, { token: doctor.token })).error?.code, 'invalid_transition');
    assert.equal((await status(doctor.token, appointment.id, 'no_show')).error?.code, 'invalid_transition');
    assert.equal((await status(doctor.token, appointment.id, 'complete')).status, 400);

    const later = expectOk(await book(patient.token, doctor.id, iso(TOMORROW, '11:00'), patient.profileId));
    assert.equal((await status(deskToken, later.id, 'check_in', '/api/clinic/desk')).error?.code, 'invalid_transition');

    expectOk(await status(deskToken, appointment.id, 'check_in', '/api/clinic/desk'));
    assert.equal((await api('POST', `/api/clinic/me/appointments/${appointment.id}/cancel`, { token: patient.token, body: {} })).error?.code, 'invalid_transition');
  });

  test('the queue orders by slot, late arrivals by arrival; the doctor hears about each new next patient once', async () => {
    setClock(TODAY, '09:00');
    const doctor = await addDoctor('Dr. Queue Order', 'cardiology');
    const [a, b, c] = [await resident(), await resident(), await resident()];
    const at10 = expectOk(await book(a.token, doctor.id, iso(TODAY, '10:20'), a.profileId));
    const at1040 = expectOk(await book(b.token, doctor.id, iso(TODAY, '10:40'), b.profileId));
    const at1100 = expectOk(await book(c.token, doctor.id, iso(TODAY, '11:20'), c.profileId));
    const doctorEvents = await listen(doctor.token);
    const patientEvents = await listen(b.token);

    // b arrives early: next, announced once.
    setClock(TODAY, '10:05');
    expectOk(await status(deskToken, at1040.id, 'check_in', '/api/clinic/desk'));
    await doctorEvents.waitFor((event) => event.kind === 'next_patient' && event.appointment_id === at1040.id);
    await patientEvents.waitFor((event) => event.kind === 'appointment' && event.appointment_id === at1040.id);
    assert.ok(!patientEvents.events.some((event) => event.kind === 'next_patient'), 'the resident is not sent the doctor’s notice');

    // a's slot (10:20) is earlier, but a arrives at 10:45, past the 10-minute grace and after b's
    // 10:40 slot: a is queued by arrival, behind b, instead of jumping ahead.
    setClock(TODAY, '10:45');
    expectOk(await status(deskToken, at10.id, 'check_in', '/api/clinic/desk'));
    // c arrives early for 11:20 and keeps their slot's place.
    setClock(TODAY, '10:46');
    expectOk(await status(deskToken, at1100.id, 'check_in', '/api/clinic/desk'));
    let board = expectOk(await api<Record<string, any>>('GET', '/api/clinic/doctor/dashboard', { token: doctor.token }));
    assert.deepEqual(board.queue.map((entry: { id: string }) => entry.id), [at1040.id, at10.id, at1100.id]);
    assert.equal(board.queue[1].arrived_late, true);
    assert.equal(board.next.id, at1040.id);
    await settle();
    assert.equal(doctorEvents.events.filter((event) => event.kind === 'next_patient').length, 1, 'no repeat while b is still next');

    // b goes in; a is next and announced; returning b to the queue announces nobody twice.
    expectOk(await api('POST', `/api/clinic/doctor/appointments/${at1040.id}/consultation`, { token: doctor.token }));
    await doctorEvents.waitFor((event) => event.kind === 'next_patient' && event.appointment_id === at10.id);
    expectOk(await status(doctor.token, at1040.id, 'return_to_queue'));
    await settle();
    const notices = doctorEvents.events.filter((event) => event.kind === 'next_patient').map((event) => event.appointment_id);
    assert.deepEqual(notices, [at1040.id, at10.id]);

    // One consultation at a time.
    expectOk(await status(doctor.token, at10.id, 'start'));
    assert.equal((await status(doctor.token, at1100.id, 'start')).error?.code, 'invalid_transition');

    // A reconnect gets the current state from the dashboard, not a replay of notices.
    doctorEvents.socket.close();
    const again = await listen(doctor.token);
    await settle();
    assert.ok(!again.events.some((event) => event.kind === 'next_patient'));
    board = expectOk(await api('GET', '/api/clinic/doctor/dashboard', { token: doctor.token }));
    assert.equal(board.current?.id, at10.id);
    again.socket.close();
    patientEvents.socket.close();
  });
});

describe('history, AI and the consultation, into Health Passport', () => {
  let doctor: Awaited<ReturnType<typeof addDoctor>>;
  let deskToken: string;
  let patient: Awaited<ReturnType<typeof resident>>;
  let appointmentId: string;
  let consultationId: string;

  before(async () => {
    setClock(TODAY, '09:00');
    doctor = await addDoctor('Dr. Full Flow', 'cardiology');
    deskToken = await desk();
    patient = await resident();
    const add = (section: string, body: Record<string, unknown>) => api('POST', `/health/profiles/${patient.profileId}/${section}`, { token: patient.token, body });
    expectOk(await add('allergies', { substance: 'Penicillin', reaction: 'rash and swelling', severity: 'severe' }));
    expectOk(await add('medications', { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: '2019-06-01', end: null }));
    expectOk(await add('conditions', { name: 'Type 2 diabetes', diagnosed: '2019-05-20', status: 'active' }));
    const booked = expectOk(await book(patient.token, doctor.id, iso(TODAY, '12:00'), patient.profileId, { share_history: false, ai_consent: false }));
    appointmentId = booked.id;
  });

  test('without the resident sharing it, the doctor sees only basics; with it, the record and its provenance', async () => {
    const limited = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/appointments/${appointmentId}/history`, { token: doctor.token }));
    assert.equal(limited.access.level, 'limited');
    assert.equal(limited.passport, null);
    assert.equal(limited.patient.date_of_birth, null);

    expectOk(await api('PATCH', `/api/clinic/me/appointments/${appointmentId}/consents`, { token: patient.token, body: { share_history: true } }));
    const full = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/appointments/${appointmentId}/history`, { token: doctor.token }));
    assert.equal(full.access.level, 'full');
    assert.equal(full.passport.sections.allergies[0].provenance, 'patient_entered');
    const actions = (db().prepare('SELECT action FROM clinic_audit WHERE appointment_id = ?').all(appointmentId) as { action: string }[]).map((row) => row.action);
    assert.ok(actions.includes('history.viewed'));
  });

  test('the AI summary needs AI consent, cites only real records, and never says "no allergies" for a gap', async () => {
    const refused = await api('POST', `/api/clinic/doctor/appointments/${appointmentId}/history-summary`, { token: doctor.token, body: { lang: 'en' } });
    assert.equal(refused.error?.code, 'consent_required');
    assert.equal(ai.calls.length, 0, 'nothing went to the AI without consent');

    expectOk(await api('PATCH', `/api/clinic/me/appointments/${appointmentId}/consents`, { token: patient.token, body: { ai_consent: true } }));
    const summary = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/appointments/${appointmentId}/history-summary`, { token: doctor.token, body: { lang: 'en' } }));
    assert.equal(summary.cached, false);
    assert.equal(summary.removed_unsupported, 2, 'the uncited and the invented statements are dropped');
    assert.deepEqual(summary.relevant_history.map((entry: { text: string }) => entry.text), ['Type 2 diabetes, diagnosed May 2019, active.']);
    assert.equal(summary.allergies.documented, true);
    assert.equal(summary.sources.P1.kind, 'passport');
    assert.ok(summary.missing_information.includes('Blood type is not recorded.'));

    const request = ai.calls[0];
    assert.equal(request.headers['anthropic-version'], '2026-10-21');
    assert.equal(request.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(request.body.model, 'claude-opus-5-5');
    assert.equal(request.body.fallbacks, 'default');
    assert.equal((request.body.output_config as { format: { type: string } }).format.type, 'json_schema');
    assert.ok(!JSON.stringify(request.body).includes('Patient Number'), 'the patient’s name is never sent to the AI');

    const cached = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/appointments/${appointmentId}/history-summary`, { token: doctor.token, body: { lang: 'en' } }));
    assert.equal(cached.cached, true);
    assert.equal(ai.calls.length, 1, 'unchanged records are not summarized again');
  });

  test('a summary is split for speech at sentence ends, short first, nothing lost', () => {
    const english = `${SPOKEN_SCRIPT}\n\n${CLOSING.en}`;
    const parts = speechParts(english);
    assert.ok(parts[0].length <= 160 && parts.slice(1).every((part) => part.length <= 450));
    assert.ok(parts.every((part) => /[.!?؟]$/.test(part)), 'no part stops mid-sentence');
    assert.equal(parts.join(' '), english.replace(/\s+/g, ' '));

    // Arabic question marks end sentences too; a sentence too long to share a part gets its own.
    const long = `${'بياخد ميتفورمين ٥٠٠ مليجرام مرتين في اليوم، '.repeat(6).trim()}.`;
    assert.deepEqual(speechParts(`هل عنده حساسية؟ ${long} ${long}`), ['هل عنده حساسية؟', long, long]);
    assert.deepEqual(speechParts('  '), []);
  });

  test('“Listen” speaks a checked handover part by part, through the backend only; AI failures are reported, not hidden', async () => {
    const speech = `/api/clinic/doctor/appointments/${appointmentId}/history-summary/speech`;
    const plan = expectOk(await api<{ version: string; parts: number[] }>('POST', speech, { token: doctor.token, body: { lang: 'en' } }));
    assert.ok(plan.parts.length >= 2, 'the handover is voiced in parts');
    assert.equal(voice.tts.length, 0, 'preparing writes the script; no audio is made until a part is asked for');

    const first = await api<Buffer>('GET', `${speech}/0?lang=en&v=${plan.version}`, { token: doctor.token });
    assert.equal(first.status, 200);
    assert.equal(first.data.toString(), 'ID3-fake-mp3-audio');
    assert.equal(voice.tts.length, 1, 'one part, one request');
    assert.ok(voice.tts[0].startsWith('Patient is 58 years old'));
    assert.ok(voice.tts[0].length <= 160, 'the first part is short, so playback starts quickly');
    for (let index = 1; index < plan.parts.length; index += 1) {
      assert.equal((await api('GET', `${speech}/${index}?lang=en&v=${plan.version}`, { token: doctor.token })).status, 200);
    }
    assert.deepEqual(voice.tts.map((part) => part.length), plan.parts);
    assert.equal(voice.tts.join(' '), `${SPOKEN_SCRIPT} ${CLOSING.en}`, 'every part, in order, and the closing line added by the server');
    assert.equal((await api('GET', `${speech}/${plan.parts.length}?lang=en&v=${plan.version}`, { token: doctor.token })).status, 404);
    const stale = await api('GET', `${speech}/0?lang=en&v=0000000000000000`, { token: doctor.token });
    assert.equal(stale.status, 409, 'a part of a rewritten script is refused, so two scripts are never mixed');
    assert.equal((await api('GET', `${speech}/0?lang=ar&v=${plan.version}`, { token: doctor.token })).status, 404, 'parts need a prepared script');
    assert.equal(voice.tts.length, plan.parts.length);

    const spokenRequest = ai.calls.at(-1) as (typeof ai.calls)[number];
    const input = JSON.parse(((spokenRequest.body.messages as { content: { text: string }[] }[])[0].content.at(-1) as { text: string }).text);
    assert.equal(input.doctor_specialty, 'cardiology');
    assert.equal(input.facts.patient.name, 'Patient', 'the handover gets the first name only');
    assert.ok(!JSON.stringify(spokenRequest.body).includes('Patient Number'));
    // The checked script is reused while the record is unchanged.
    const calls = ai.calls.length;
    const again = expectOk(await api<{ version: string }>('POST', speech, { token: doctor.token, body: { lang: 'en' } }));
    assert.equal(ai.calls.length, calls);
    assert.equal(again.version, plan.version);

    ai.mode = 'error';
    const failed = await api('POST', `/api/clinic/doctor/appointments/${appointmentId}/history-summary`, { token: doctor.token, body: { lang: 'ar' } });
    assert.equal(failed.status, 502);
    assert.equal(failed.error?.code, 'ai_failed');
    ai.mode = 'refusal';
    assert.equal((await api('POST', `/api/clinic/doctor/appointments/${appointmentId}/history-summary`, { token: doctor.token, body: { lang: 'ar' } })).error?.code, 'ai_failed');
    ai.mode = 'ok';
  });

  test('recording needs consent; a segment is transcribed once however often it is sent', async () => {
    setClock(TODAY, '11:55');
    expectOk(await status(deskToken, appointmentId, 'check_in', '/api/clinic/desk'));
    const opened = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/appointments/${appointmentId}/consultation`, { token: doctor.token }));
    consultationId = opened.id;
    assert.equal(opened.status, 'draft');
    assert.equal(opened.appointment.status, 'in_consultation');
    const reopened = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/appointments/${appointmentId}/consultation`, { token: doctor.token }));
    assert.equal(reopened.id, consultationId, 'opening twice makes one consultation');

    const audio = Buffer.alloc(4_000, 1);
    const upload = () => api<Record<string, any>>('POST', `/api/clinic/doctor/consultations/${consultationId}/segments?seq=0&lang=en&duration_ms=30000`, { token: doctor.token, raw: audio });
    assert.equal((await upload()).error?.code, 'consent_required');
    expectOk(await api('POST', `/api/clinic/doctor/consultations/${consultationId}/recording-consent`, { token: doctor.token }));
    const first = expectOk(await upload());
    assert.equal(first.duplicate, false);
    assert.deepEqual(first.segment.utterances.map((u: { speaker: string }) => u.speaker), ['speaker_0', 'speaker_1']);
    const retry = expectOk(await upload());
    assert.equal(retry.duplicate, true);
    assert.equal(voice.stt, 1);
    assert.equal((await api('POST', `/api/clinic/doctor/consultations/${consultationId}/segments?seq=1`, { token: doctor.token, raw: Buffer.alloc(10) })).status, 422);
  });

  test('the AI drafts a note beside the doctor’s draft, with unbacked items flagged', async () => {
    const before = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/consultations/${consultationId}`, { token: doctor.token }));
    const drafted = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/consultations/${consultationId}/ai-draft`, { token: doctor.token, body: { lang: 'en' } }));
    assert.equal(drafted.draft.chief_complaint, '', 'the doctor’s own draft is untouched');
    assert.equal(drafted.ai_draft.note.diagnoses[0].certainty, 'provisional');
    const flagged = drafted.ai_draft.flags.map((flag: { field: string; origin: string }) => `${flag.origin}:${flag.field}`);
    assert.ok(flagged.includes('check:investigations[1]'), 'a test with no quote is flagged');
    assert.ok(flagged.includes('check:assessment'), 'a quote that is not in the transcript is flagged');
    assert.ok(!flagged.includes('check:medications[0]'), 'a quoted prescription passes');
    assert.ok(flagged.includes('model:medications[0].route'));
    assert.ok(drafted.version > before.version);
    assert.ok(String(ai.calls.at(-1)?.body.system).includes('SOAP'));
  });

  test('drafts save with a version, stale saves are refused, and finalizing writes Health Passport exactly once', async () => {
    let current = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/consultations/${consultationId}`, { token: doctor.token }));
    const note = { ...current.ai_draft.note, assessment: 'Likely stable angina; rule out hypertension.' };
    const saved = expectOk(await api<Record<string, any>>('PUT', `/api/clinic/doctor/consultations/${consultationId}/draft`, { token: doctor.token, body: { version: current.version, draft: note, notes: 'Smoker, 20/day.', ai_applied: true } }));
    const stale = await api('PUT', `/api/clinic/doctor/consultations/${consultationId}/draft`, { token: doctor.token, body: { version: current.version, notes: 'older tab' } });
    assert.equal(stale.error?.code, 'version_conflict');

    const unattested = await api('POST', `/api/clinic/doctor/consultations/${consultationId}/finalize`, { token: doctor.token, body: { version: saved.version, note } });
    assert.equal(unattested.status, 422);
    const empty = await api('POST', `/api/clinic/doctor/consultations/${consultationId}/finalize`, { token: doctor.token, body: { version: saved.version, note: { ...note, chief_complaint: '' }, attest: true } });
    assert.equal(empty.status, 422);
    assert.equal(db().prepare("SELECT status FROM clinic_consultations WHERE id = ?").get(consultationId)?.status, 'draft', 'a refused finalize changes nothing');

    const patientEvents = await listen(patient.token);
    const finalized = await Promise.all([
      api<Record<string, any>>('POST', `/api/clinic/doctor/consultations/${consultationId}/finalize`, { token: doctor.token, body: { version: saved.version, note, attest: true, ai_applied: true } }),
      api<Record<string, any>>('POST', `/api/clinic/doctor/consultations/${consultationId}/finalize`, { token: doctor.token, body: { version: saved.version, note, attest: true, ai_applied: true } }),
    ]);
    assert.ok(finalized.every((result) => result.ok));
    assert.deepEqual(finalized.map((result) => result.data.already_finalized).sort(), [false, true]);
    current = finalized[0].data;
    assert.equal(current.status, 'final');
    assert.equal(current.appointment.status, 'completed');
    assert.equal(current.passport_synced, true);
    assert.equal(current.finalized_by, 'Dr. Full Flow');
    await patientEvents.waitFor((event) => event.kind === 'consultation_final');
    patientEvents.socket.close();

    const fromVisit = db().prepare('SELECT section, COUNT(*) AS count FROM health_items WHERE source = ? GROUP BY section ORDER BY section').all(`consultation:${consultationId}`);
    assert.deepEqual(fromVisit.map((row) => ({ ...row })), [{ section: 'medications', count: 1 }, { section: 'visits', count: 1 }]);

    assert.equal((await api('PUT', `/api/clinic/doctor/consultations/${consultationId}/draft`, { token: doctor.token, body: { version: current.version, notes: 'late edit' } })).error?.code, 'invalid_transition');
    const amended = expectOk(await api<Record<string, any>>('POST', `/api/clinic/doctor/consultations/${consultationId}/addenda`, { token: doctor.token, body: { text: 'ECG booked for 4 Nov.' } }));
    assert.equal(amended.addenda.length, 1);
    assert.equal(amended.final.assessment, note.assessment, 'the approved record itself never changes');
  });

  test('the resident reads the approved visit in Health Passport, without transcript or AI output', async () => {
    const record = expectOk(await api<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/record`, { token: patient.token }));
    assert.equal(record.consultations.length, 1);
    assert.deepEqual(record.consultations[0].diagnoses, ['Stable angina']);
    const visit = record.visits.find((item: { source: string }) => item.source === `consultation:${consultationId}`);
    assert.equal(visit.specialty, 'Cardiology');
    const aspirin = record.medications.find((item: { name: string }) => item.name === 'Aspirin');
    assert.equal(aspirin.start, TODAY);
    assert.equal(aspirin.end, '2026-12-01');

    const detail = expectOk(await api<Record<string, any>>('GET', `/health/consultations/${consultationId}`, { token: patient.token }));
    assert.equal(detail.note.patient_instructions, noteReply.note.patient_instructions);
    assert.equal(detail.approved_by, 'Dr. Full Flow');
    assert.equal(detail.ai_assisted, true);
    assert.equal(detail.addenda[0].text, 'ECG booked for 4 Nov.');
    for (const hidden of ['transcript', 'ai_draft', 'draft', 'notes']) assert.ok(!(hidden in detail), `${hidden} is not shown to the patient`);
    assert.equal((await api('GET', `/health/consultations/${consultationId}`, { token: (await resident()).token })).status, 404);

    const mine = expectOk(await api<{ id: string; consultation_id: string }[]>('GET', '/api/clinic/me/appointments', { token: patient.token }));
    assert.equal(mine.find((entry) => entry.id === appointmentId)?.consultation_id, consultationId);
  });

  test('transcripts and AI drafts are deleted after the retention period; the record stays', async () => {
    setClock('2026-12-05', '09:00');
    assert.equal(purgeExpiredContent(), 1);
    // A month on, the doctor's 12-hour session is long over.
    assert.equal((await api('GET', '/api/clinic/doctor/me', { token: doctor.token })).status, 401);
    doctor.token = await signIn(doctor.email, 'doctor password 123');
    const kept = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/consultations/${consultationId}`, { token: doctor.token }));
    assert.equal(kept.transcript.segments.length, 0);
    assert.equal(kept.ai_draft, null);
    assert.equal(kept.content_purged, true);
    assert.equal(kept.final.chief_complaint, 'Chest tightness on exertion');
    const history = expectOk(await api<Record<string, any>>('GET', `/api/clinic/doctor/appointments/${appointmentId}/history`, { token: doctor.token }));
    assert.equal(history.access.level, 'limited', 'shared access ends a week after the visit');
    setClock(TODAY, '09:00');
  });
});
