import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.ts';

/**
 * EMS accounts, the device registry and the Alexa link, in DATA_DIR/ems.db
 * (SQLite, built into Node, so the backend stays dependency-free).
 *
 * Tokens and codes are stored as SHA-256 hashes, never as issued. Amazon's
 * tokens and plug keys are sealed with secrets.ts before they are written.
 */

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- EMS-issued bearer tokens. kind: session (the app), alexa_access, alexa_refresh.
  CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    client_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX tokens_user ON tokens(user_id, kind);

  -- EMS authorization codes handed to Alexa (single use, short lived).
  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    room TEXT,
    type TEXT NOT NULL,
    protocol TEXT NOT NULL,
    -- The hardware's own id where it has one (a SONOFF plug's device id); not secret.
    external_id TEXT,
    -- Last state the adapter confirmed; never the requested one.
    online INTEGER NOT NULL DEFAULT 0,
    power TEXT NOT NULL DEFAULT 'unknown',
    -- A command in flight, so every client can show it as pending.
    pending_power TEXT,
    alexa_enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    last_error TEXT,
    -- Adapter settings, sealed (plug id, key, address).
    adapter_config TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX devices_owner ON devices(owner_id);
  CREATE UNIQUE INDEX devices_hardware ON devices(protocol, external_id) WHERE external_id IS NOT NULL;

  -- One Alexa link per EMS user. status: linked, unlinked, failed, expired.
  CREATE TABLE alexa_links (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    amazon_refresh_token TEXT,
    amazon_access_token TEXT,
    amazon_access_expires_at INTEGER,
    api_endpoint TEXT,
    linked_at TEXT,
    checked_at INTEGER,
    last_error TEXT,
    updated_at TEXT NOT NULL
  );

  -- A linking attempt the app started, until Login with Amazon redirects back.
  CREATE TABLE link_states (
    state_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // 2: account roles and Health Passport (server/src/health).
  `
  -- resident (the app), doctor, or clinic_staff (the clinic's front desk).
  -- /api/auth/register only ever makes residents; the clinic CLI makes the others.
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'resident';

  CREATE TABLE health_consents (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    given INTEGER NOT NULL,
    given_at TEXT,
    updated_at TEXT NOT NULL
  );

  -- The resident's own record (relation self) and their family members'.
  CREATE TABLE health_profiles (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    name TEXT NOT NULL,
    sex TEXT,
    date_of_birth TEXT,
    blood_type TEXT,
    record_updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX health_profiles_owner ON health_profiles(owner_id);

  -- One item of a record: an allergy, a medication, a visit... \`data\` is its
  -- fields as JSON, sealed. source: null when typed in, a document id, or
  -- consultation:<id> for a visit a clinic doctor finalized.
  CREATE TABLE health_items (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES health_profiles(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    data TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX health_items_profile ON health_items(profile_id, section);
  CREATE INDEX health_items_source ON health_items(source) WHERE source IS NOT NULL;
  `,
  // 3: the compound clinic (server/src/clinic). Clinical text is sealed; names, times and statuses are not.
  `
  CREATE TABLE clinic_specialties (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE clinic_doctors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    specialty_id TEXT NOT NULL REFERENCES clinic_specialties(id),
    display_name TEXT NOT NULL,
    display_name_ar TEXT,
    title TEXT,
    title_ar TEXT,
    bio TEXT,
    bio_ar TEXT,
    years_experience INTEGER,
    consultation_minutes INTEGER NOT NULL,
    fee_egp INTEGER,
    -- JSON array of language codes the doctor consults in.
    languages TEXT,
    -- A file in DATA_DIR/clinic/photos, or null.
    photo TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX clinic_doctors_specialty ON clinic_doctors(specialty_id);

  -- Weekly hours in the clinic's time zone. weekday: 0 Sunday .. 6 Saturday.
  CREATE TABLE clinic_schedules (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
  );
  CREATE INDEX clinic_schedules_doctor ON clinic_schedules(doctor_id, weekday);

  -- Time a doctor is away; no slots are offered inside it.
  CREATE TABLE clinic_time_off (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT
  );

  CREATE TABLE clinic_appointments (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES clinic_doctors(id),
    -- The Health Passport profile the visit is for. The patient's details are
    -- kept as booked, so the clinic's record survives the profile being removed.
    patient_profile_id TEXT REFERENCES health_profiles(id) ON DELETE SET NULL,
    patient_name TEXT NOT NULL,
    patient_sex TEXT,
    patient_dob TEXT,
    booked_by TEXT NOT NULL REFERENCES users(id),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL,
    -- Sealed: why the resident is coming.
    reason TEXT,
    -- The resident's choices, per appointment: let this doctor read the Health
    -- Passport, and let AI services process the visit.
    share_history INTEGER NOT NULL DEFAULT 0,
    share_history_at TEXT,
    ai_consent INTEGER NOT NULL DEFAULT 0,
    ai_consent_at TEXT,
    -- 'resident', or the doctor's user id when the patient agreed in the room.
    ai_consent_by TEXT,
    checked_in_at TEXT,
    checked_in_by TEXT,
    ready_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    cancelled_by TEXT,
    cancel_reason TEXT,
    no_show_at TEXT,
    rescheduled_from TEXT,
    rescheduled_to TEXT,
    -- When the doctor was told this patient is next; once per appointment.
    next_notified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- The database itself refuses a double booking, however requests interleave:
  -- one live appointment per doctor per start time, and per patient per start time.
  CREATE UNIQUE INDEX clinic_appointments_slot ON clinic_appointments(doctor_id, starts_at)
    WHERE status NOT IN ('cancelled', 'rescheduled');
  CREATE UNIQUE INDEX clinic_appointments_patient_slot ON clinic_appointments(patient_profile_id, starts_at)
    WHERE status NOT IN ('cancelled', 'rescheduled') AND patient_profile_id IS NOT NULL;
  CREATE INDEX clinic_appointments_doctor_time ON clinic_appointments(doctor_id, starts_at);
  CREATE INDEX clinic_appointments_booker ON clinic_appointments(booked_by, starts_at);
  CREATE INDEX clinic_appointments_patient ON clinic_appointments(patient_profile_id, starts_at);

  -- One per appointment. A draft is edited freely (optimistic \`version\`); once
  -- final it never changes, and corrections become addenda.
  CREATE TABLE clinic_consultations (
    id TEXT PRIMARY KEY,
    appointment_id TEXT NOT NULL UNIQUE REFERENCES clinic_appointments(id),
    doctor_id TEXT NOT NULL REFERENCES clinic_doctors(id),
    patient_profile_id TEXT REFERENCES health_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    recording_consent_at TEXT,
    -- Sealed: the doctor's typed notes, the note being edited (JSON), the
    -- corrected transcript, and what the AI proposed (kept to audit it).
    notes TEXT,
    draft TEXT,
    transcript_edited TEXT,
    ai_draft TEXT,
    ai_generated_at TEXT,
    ai_used INTEGER NOT NULL DEFAULT 0,
    -- Sealed JSON: the record as the doctor approved it.
    final TEXT,
    finalized_at TEXT,
    finalized_by TEXT REFERENCES users(id),
    passport_synced_at TEXT,
    -- When the transcript and AI draft were deleted under the retention rule.
    content_purged_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX clinic_consultations_patient ON clinic_consultations(patient_profile_id, status);
  CREATE INDEX clinic_consultations_doctor ON clinic_consultations(doctor_id, status, finalized_at);

  -- Speech-to-text, one recorded segment at a time, so an interrupted recording
  -- keeps what was already transcribed. The audio itself is never stored.
  CREATE TABLE clinic_transcript_segments (
    id TEXT PRIMARY KEY,
    consultation_id TEXT NOT NULL REFERENCES clinic_consultations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    duration_ms INTEGER,
    language TEXT,
    -- Sealed JSON: { text, utterances: [{ speaker, text }] }.
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (consultation_id, seq)
  );

  CREATE TABLE clinic_addenda (
    id TEXT PRIMARY KEY,
    consultation_id TEXT NOT NULL REFERENCES clinic_consultations(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- AI history summaries: decision support for one visit, never part of the
  -- record. Sealed, and deleted once expired.
  CREATE TABLE clinic_history_summaries (
    appointment_id TEXT NOT NULL REFERENCES clinic_appointments(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    content TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (appointment_id, lang)
  );

  -- Who did what to which record, and when. Ids and action names only, never clinical text.
  CREATE TABLE clinic_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    appointment_id TEXT,
    consultation_id TEXT,
    patient_profile_id TEXT,
    detail TEXT
  );
  CREATE INDEX clinic_audit_appointment ON clinic_audit(appointment_id);
  CREATE INDEX clinic_audit_patient ON clinic_audit(patient_profile_id);
  `,
  // 4: Health Passport documents and spoken summaries (server/src/health/documents.ts, summaries.ts).
  `
  CREATE TABLE health_documents (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES health_profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    document_date TEXT,
    uploaded_at TEXT NOT NULL,
    -- processing, needs_review, confirmed or failed; error_code says why it failed.
    status TEXT NOT NULL,
    error_code TEXT,
    -- JSON [{ "file", "mime" }]: the pages, sealed in DATA_DIR/health/files.
    pages TEXT NOT NULL,
    -- Sealed: what was read, and the items still waiting for the resident's check.
    extracted_text TEXT,
    extracted_items TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX health_documents_profile ON health_documents(profile_id, uploaded_at);

  -- One spoken summary per profile, language and specialty ('general' without one).
  CREATE TABLE health_summaries (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES health_profiles(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    specialty TEXT NOT NULL,
    -- generating (phase waiting, writing, recording), ready or failed.
    status TEXT NOT NULL,
    phase TEXT,
    -- The record version it is made from, to tell when it is out of date.
    record_updated_at TEXT NOT NULL,
    -- Sealed script, and the sealed recording's file in DATA_DIR/health/files.
    transcript TEXT,
    audio_file TEXT,
    error_code TEXT,
    started_at TEXT NOT NULL,
    generated_at TEXT,
    failed_at TEXT,
    UNIQUE (profile_id, lang, specialty)
  );

  -- The clinic's spoken handover for a visit ("Listen to summary"): the sealed script, until a day after the visit.
  CREATE TABLE clinic_spoken_summaries (
    appointment_id TEXT NOT NULL REFERENCES clinic_appointments(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    script TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (appointment_id, lang)
  );
  `,
];

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) {
    return instance;
  }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(config.dataDir, 'ems.db'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = database.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) {
    database.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  }
  while (version < MIGRATIONS.length) {
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[version]);
      version += 1;
      database.prepare('UPDATE schema_version SET version = ?').run(version);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  instance = database;
  return database;
}

/** For tests that reopen the database, as after a restart. */
export function closeDb(): void {
  instance?.close();
  instance = null;
}

export function transaction<T>(work: () => T): T {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
