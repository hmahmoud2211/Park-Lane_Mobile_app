import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.ts';

/**
 * EMS accounts and their tokens, in DATA_DIR/ems.db (SQLite, built into
 * Node, so the backend stays dependency-free).
 *
 * Tokens are stored as SHA-256 hashes, never as issued. Other secrets are
 * sealed with secrets.ts before they are written.
 *
 * Append a migration to change the schema; never edit one that has shipped.
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
  // The CUBE / SONOFF device registry and the custom Alexa skill are gone.
  `
  DROP TABLE devices;
  DROP TABLE oauth_codes;
  DROP TABLE alexa_links;
  DROP TABLE link_states;
  DELETE FROM tokens WHERE kind <> 'session';
  `,
  // Units, their residents and the Home Assistant hub behind each (src/ha/).
  `
  CREATE TABLE units (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    building TEXT,
    created_at TEXT NOT NULL
  );

  -- One unit per resident for now. role: owner, member.
  CREATE TABLE unit_members (
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (unit_id, user_id)
  );

  -- kind: container (provisioned here) or box (a hub in the unit, attached by an admin).
  -- status: provisioning, online, offline, auth_failed, failed.
  CREATE TABLE hubs (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL UNIQUE REFERENCES units(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    base_url TEXT,
    -- The facade's long-lived Home Assistant token, sealed.
    token_sealed TEXT,
    -- The facade user's password, sealed, to issue a new token if one is lost.
    admin_password_sealed TEXT,
    container_name TEXT,
    ha_version TEXT,
    status TEXT NOT NULL,
    last_seen TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    hub_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    at TEXT NOT NULL
  );
  `,
  // Account-linking flows in progress: which resident started which HA config flow, on which hub.
  `
  CREATE TABLE pairing_sessions (
    flow_id TEXT PRIMARY KEY,
    hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    handler TEXT NOT NULL,
    -- The current form's fields (name, section), to nest the answers as HA expects.
    fields TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // Assistant tokens (kind 'assistant') belong to the app session that asked for them, so
  // signing out ends them too. The audit log says when a command came from the assistant.
  `
  ALTER TABLE tokens ADD COLUMN parent_hash TEXT;
  CREATE INDEX tokens_parent ON tokens(parent_hash) WHERE parent_hash IS NOT NULL;
  -- via: NULL for the app, 'assistant' for the Parklane Assistant (voice and chat).
  ALTER TABLE audit_log ADD COLUMN via TEXT;
  `,
  // 6: account roles and Health Passport (src/health/).
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
  // 7: the compound clinic (src/clinic/). Clinical text is sealed; names, times and statuses are not.
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
  // 8: Health Passport documents and spoken summaries (src/health/documents.ts, summaries.ts).
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
  `
  -- The CUBE gateway serving a unit (one each), for gateway access through EMS accounts: residents get a pass the
  -- gateway checks with the backend's public key; the gateway asks which residents are still members, proving
  -- itself with its sync secret (stored hashed, like tokens).
  CREATE TABLE gateways (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL UNIQUE REFERENCES units(id) ON DELETE CASCADE,
    url TEXT,
    secret_hash TEXT NOT NULL,
    last_sync TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- The Ed25519 key that signs gateway passes: one row, the private key sealed.
  CREATE TABLE gateway_signing_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    private_sealed TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  -- Codes an owner makes so another account can join their unit (stored hashed, single use, a day).
  CREATE TABLE unit_invites (
    code_hash TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by TEXT,
    used_at INTEGER
  );
  CREATE INDEX unit_invites_unit ON unit_invites(unit_id);
  `,
  `
  -- Accounts an admin created or reset with a temporary password must choose their own first.
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- The CUBE gateway container this backend runs for a unit (ems/gatewayProvisioner.ts). Its link to the unit is
  -- the gateways row with the same id; the sync secret lives only in the container's environment and that row's hash.
  CREATE TABLE gateway_containers (
    unit_id TEXT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL UNIQUE,
    container_name TEXT NOT NULL UNIQUE,
    port INTEGER UNIQUE,
    status TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  -- A Health Passport profile its keeper (health_profiles.owner_id) shares with another resident of the same
  -- apartment (health/sharing.ts). access: view, edit. A share means nothing once the two no longer live in the
  -- same unit, so leaving or moving out ends every share the resident gave or got.
  CREATE TABLE health_shares (
    profile_id TEXT NOT NULL REFERENCES health_profiles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, user_id)
  );
  CREATE INDEX health_shares_user ON health_shares(user_id);
  CREATE TRIGGER health_shares_end_on_leave AFTER DELETE ON unit_members
  BEGIN
    DELETE FROM health_shares
    WHERE user_id = OLD.user_id OR profile_id IN (SELECT id FROM health_profiles WHERE owner_id = OLD.user_id);
  END;
  CREATE TRIGGER health_shares_end_on_move AFTER UPDATE OF unit_id ON unit_members WHEN OLD.unit_id IS NOT NEW.unit_id
  BEGIN
    DELETE FROM health_shares
    WHERE user_id = OLD.user_id OR profile_id IN (SELECT id FROM health_profiles WHERE owner_id = OLD.user_id);
  END;
  `,  `
  -- Sites: a compound, and everything building-wide belongs to one (announcements, amenities, parking, BMS
  -- readings). kind 'demo' sites are the only ones the data generator writes to (scripts/generate-series.ts).
  -- series_key is the compact integer the time-series tables use instead of the text id.
  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('real', 'demo')),
    series_key INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  INSERT INTO sites (id, name, timezone, kind, series_key, created_at)
    VALUES ('park-lane', 'Park Lane', 'Africa/Cairo', 'real', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

  -- A unit's site and details, set by building management (they were invented in the app before).
  -- SQLite only adds a REFERENCES column with a NULL default, so units.ts always writes site_id.
  ALTER TABLE units ADD COLUMN site_id TEXT REFERENCES sites(id);
  UPDATE units SET site_id = 'park-lane';
  ALTER TABLE units ADD COLUMN tower TEXT;
  ALTER TABLE units ADD COLUMN floor INTEGER;
  ALTER TABLE units ADD COLUMN number TEXT;
  ALTER TABLE units ADD COLUMN unit_type TEXT;
  ALTER TABLE units ADD COLUMN bedrooms INTEGER;
  ALTER TABLE units ADD COLUMN bathrooms INTEGER;
  ALTER TABLE units ADD COLUMN area_m2 REAL;
  ALTER TABLE units ADD COLUMN parking_bay TEXT;
  ALTER TABLE units ADD COLUMN handover_status TEXT;
  ALTER TABLE units ADD COLUMN series_key INTEGER;
  CREATE UNIQUE INDEX units_series_key ON units(series_key);
  CREATE INDEX units_site ON units(site_id);

  -- Per-site rules management can change (emergency number, visiting hours, booking windows…), as JSON
  -- validated by ems/siteSettings.ts; missing keys take the defaults there.
  CREATE TABLE site_settings (
    site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
    settings TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Server-issued references people read and quote (REQ-2026-00124, BK-01001, receipts), one counter per kind.
  CREATE TABLE reference_counters (
    site_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    year INTEGER NOT NULL,
    next INTEGER NOT NULL,
    PRIMARY KEY (site_id, kind, year)
  );

  -- The in-app inbox every feature reports to (ems/notifications.ts). Only that person's, so it goes with them.
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    ref_type TEXT,
    ref_id TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, created_at);
  CREATE TABLE notification_prefs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );

  -- What building management changed, and who (actor_id: the admin, or NULL for the API key).
  CREATE TABLE admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX admin_audit_target ON admin_audit(target_type, target_id);
  `,  `
  -- My Unit and Bills (unit/finance.ts). Money is integer piastres (EGP × 100); dates are YYYY-MM-DD in the
  -- site's time zone. Finance belongs to the unit, not to a person, so it outlives any account (legal records).
  CREATE TABLE unit_contracts (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'lease')),
    price INTEGER NOT NULL CHECK (price > 0),
    signed_on TEXT,
    handover_on TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX unit_contracts_unit ON unit_contracts(unit_id);

  -- What the unit owes: the contract's down payment and installments, service charges, utility bills.
  -- status is due or void; paid and partial follow from the payments against it.
  CREATE TABLE unit_charges (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    contract_id TEXT REFERENCES unit_contracts(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('down_payment', 'installment', 'service_charge', 'electricity', 'water', 'gas', 'other')),
    title TEXT NOT NULL,
    period TEXT,
    due_on TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('due', 'void')),
    reference TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX unit_charges_unit ON unit_charges(unit_id, due_on);

  -- Payments building management records (cash, transfer, cheque, card at the office): never in the app.
  CREATE TABLE unit_payments (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    charge_id TEXT REFERENCES unit_charges(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    paid_on TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'card_at_office')),
    receipt_no TEXT NOT NULL UNIQUE,
    note TEXT,
    recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX unit_payments_unit ON unit_payments(unit_id, paid_on);
  CREATE INDEX unit_payments_charge ON unit_payments(charge_id);

  -- Monthly meter readings: entered by management, or later by a live meter.
  CREATE TABLE meter_readings (
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    meter TEXT NOT NULL CHECK (meter IN ('electricity', 'water', 'gas')),
    period TEXT NOT NULL,
    value REAL NOT NULL CHECK (value >= 0),
    read_on TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'live')),
    PRIMARY KEY (unit_id, meter, period)
  );

  -- Floor plans and other papers management uploads; the file is sealed (lib/sealedFiles.ts, DATA_DIR/units/files).
  CREATE TABLE unit_documents (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('floor_plan', 'contract_scan', 'other')),
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX unit_documents_unit ON unit_documents(unit_id);

  -- Visitor passes (visitors/passes.ts). The visitor's name and phone are sealed. The QR holds the pass id and a
  -- random token: token_hash finds the pass at the gate, token_sealed lets the resident show it again.
  CREATE TABLE visitor_passes (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    visitor_name TEXT NOT NULL,
    visitor_phone TEXT,
    plate TEXT,
    guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 50),
    arrives_at TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    uses TEXT NOT NULL CHECK (uses IN ('single', 'multi')),
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'arrived', 'left', 'revoked')),
    token_hash TEXT NOT NULL UNIQUE,
    token_sealed TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX visitor_passes_unit ON visitor_passes(unit_id, arrives_at);
  CREATE INDEX visitor_passes_valid_to ON visitor_passes(valid_to);
  CREATE TABLE visitor_entries (
    id TEXT PRIMARY KEY,
    pass_id TEXT NOT NULL REFERENCES visitor_passes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('entry', 'exit')),
    gate TEXT,
    at TEXT NOT NULL,
    by_user TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX visitor_entries_pass ON visitor_entries(pass_id, at);

  -- Parcels the gate or lobby logs for a unit (parcels/parcels.ts).
  CREATE TABLE parcels (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    reference TEXT NOT NULL UNIQUE,
    carrier TEXT,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'collected', 'returned')),
    received_at TEXT NOT NULL,
    received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    closed_at TEXT,
    closed_by TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX parcels_unit ON parcels(unit_id, received_at);
  CREATE INDEX parcels_waiting ON parcels(status, received_at);
  `,  `
  -- Maintenance, housekeeping and moving requests (requests/serviceRequests.ts). A request belongs to the unit and
  -- stays as the building's history; the person who made it can go (created_by SET NULL). Details and comments are
  -- sealed. Technicians are records building management keeps, not app accounts.
  CREATE TABLE technicians (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    trades TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE service_categories (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('maintenance', 'housekeeping', 'moving')),
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    sort INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (site_id, kind, id)
  );
  INSERT INTO service_categories (site_id, kind, id, title, sort, active) VALUES
    ('park-lane', 'maintenance', 'hvac', 'AC / HVAC', 1, 1),
    ('park-lane', 'maintenance', 'electrical', 'Electrical', 2, 1),
    ('park-lane', 'maintenance', 'plumbing', 'Plumbing', 3, 1),
    ('park-lane', 'maintenance', 'appliances', 'Appliances', 4, 1),
    ('park-lane', 'maintenance', 'doors', 'Doors & Locks', 5, 1),
    ('park-lane', 'maintenance', 'other', 'Other', 6, 1),
    ('park-lane', 'maintenance', 'painting', 'Painting', 7, 1),
    ('park-lane', 'maintenance', 'pest', 'Pest Control', 8, 1),
    ('park-lane', 'maintenance', 'carpentry', 'Carpentry', 9, 1),
    ('park-lane', 'housekeeping', 'standard', 'Standard cleaning', 1, 1),
    ('park-lane', 'housekeeping', 'deep', 'Deep cleaning', 2, 1),
    ('park-lane', 'housekeeping', 'windows', 'Windows & glass', 3, 1),
    ('park-lane', 'moving', 'move_in', 'Moving in', 1, 1),
    ('park-lane', 'moving', 'move_out', 'Moving out', 2, 1);
  CREATE TABLE service_requests (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('maintenance', 'housekeeping', 'moving')),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT,
    priority TEXT NOT NULL CHECK (priority IN ('normal', 'urgent')),
    preferred_date TEXT NOT NULL,
    preferred_window TEXT NOT NULL,
    scheduled_date TEXT,
    scheduled_window TEXT,
    technician_id TEXT REFERENCES technicians(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('submitted', 'assigned', 'in_progress', 'completed', 'cancelled')),
    reference TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX service_requests_unit ON service_requests(unit_id, created_at);
  CREATE INDEX service_requests_status ON service_requests(status, created_at);
  CREATE TABLE service_request_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('status', 'comment')),
    status TEXT,
    note TEXT,
    by_user TEXT REFERENCES users(id) ON DELETE SET NULL,
    by_staff INTEGER NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX service_request_events_request ON service_request_events(request_id, at);
  CREATE TABLE service_request_photos (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX service_request_photos_request ON service_request_photos(request_id);
  `,  `
  -- Community (community/community.ts): management's notices and alerts, events with RSVPs, polls with one vote
  -- per resident (changeable until the poll closes), and residents' feedback with management's reply (both
  -- sealed). Amenities (amenities/amenities.ts): the catalogue and bookings; the database itself refuses a second
  -- booking of an exclusive amenity's slot, and a second booking of the same slot by one apartment.
  CREATE TABLE announcements (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('news', 'alert')),
    level TEXT NOT NULL CHECK (level IN ('info', 'warning')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    full_text TEXT,
    picture TEXT,
    published_at TEXT NOT NULL,
    expires_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX announcements_site ON announcements(site_id, published_at);
  CREATE TABLE community_events (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    venue TEXT NOT NULL,
    picture TEXT,
    capacity INTEGER,
    rsvp_opens_at TEXT,
    rsvp_until TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX community_events_site ON community_events(site_id, starts_at);
  CREATE TABLE event_rsvps (
    event_id TEXT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
  CREATE TABLE polls (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    opens_at TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX polls_site ON polls(site_id, closes_at);
  CREATE TABLE poll_options (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    picture TEXT,
    sort INTEGER NOT NULL
  );
  CREATE INDEX poll_options_poll ON poll_options(poll_id, sort);
  CREATE TABLE poll_votes (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    voted_at TEXT NOT NULL,
    PRIMARY KEY (poll_id, user_id)
  );
  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    topic TEXT NOT NULL CHECK (topic IN ('suggestion', 'concern', 'compliment', 'other')),
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'answered', 'closed')),
    reply TEXT,
    replied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    replied_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX feedback_site ON feedback(site_id, status, created_at);
  CREATE INDEX feedback_user ON feedback(user_id, created_at);
  CREATE TABLE amenities (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    opens TEXT NOT NULL,
    closes TEXT NOT NULL,
    slot_minutes INTEGER NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity >= 1),
    max_people INTEGER NOT NULL CHECK (max_people >= 1),
    exclusive INTEGER NOT NULL,
    categories TEXT NOT NULL,
    picture TEXT,
    cancel_cutoff_hours INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX amenities_site ON amenities(site_id, active, sort);
  CREATE TABLE amenity_bookings (
    id TEXT PRIMARY KEY,
    amenity_id TEXT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    people INTEGER NOT NULL CHECK (people >= 1),
    exclusive INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('booked', 'cancelled')),
    reference TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT
  );
  CREATE UNIQUE INDEX amenity_bookings_one_per_unit ON amenity_bookings(amenity_id, unit_id, starts_at) WHERE status = 'booked';
  CREATE UNIQUE INDEX amenity_bookings_exclusive ON amenity_bookings(amenity_id, starts_at) WHERE status = 'booked' AND exclusive = 1;
  CREATE INDEX amenity_bookings_slot ON amenity_bookings(amenity_id, starts_at, status);
  CREATE INDEX amenity_bookings_unit ON amenity_bookings(unit_id, starts_at);
  `,  `
  -- Parking (parking/): the rules engine the app ran on the phone, now on the server. Each table holds one of its
  -- collections as JSON in \`data\` (sealed where it can name a person or a plate), with the columns needed to load
  -- only what a rule can touch. Pass and invitation tokens are never stored: only their hashes (crypto.ts derives
  -- the token again from the server key when an allowed person asks). \`parking_sites\` keeps the policy and the
  -- booking-reference counter. Residents and properties are the backend's own users and units.
  CREATE TABLE parking_sites (
    site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
    policy TEXT NOT NULL,
    reference_serial INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE parking_buildings (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_zones (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_spaces (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_gates (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_chargers (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_connectors (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_residents (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_properties (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_associations (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    resident_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_vehicles (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    resident_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_reservations (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    property_id TEXT NOT NULL,
    resident_id TEXT,
    status TEXT NOT NULL,
    scheduled_end TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_invitations (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    reservation_id TEXT NOT NULL,
    invite_hash TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_credentials (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    reservation_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_sessions (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    reservation_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_allocations (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    reservation_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_charging_sessions (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    reservation_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_scan_events (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    at TEXT NOT NULL,
    reservation_id TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_occupancy_events (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    at TEXT NOT NULL,
    space_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_notifications (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    at TEXT NOT NULL,
    audience TEXT NOT NULL,
    resident_id TEXT,
    reservation_id TEXT,
    open INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE TABLE parking_audit (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    at TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (site_id, id)
  );
  CREATE INDEX parking_reservations_site ON parking_reservations(site_id, status, scheduled_end);
  CREATE INDEX parking_reservations_property ON parking_reservations(property_id);
  CREATE INDEX parking_reservations_resident ON parking_reservations(resident_id);
  CREATE UNIQUE INDEX parking_invitations_hash ON parking_invitations(invite_hash);
  CREATE UNIQUE INDEX parking_credentials_hash ON parking_credentials(token_hash);
  CREATE INDEX parking_invitations_reservation ON parking_invitations(reservation_id);
  CREATE INDEX parking_credentials_reservation ON parking_credentials(reservation_id);
  CREATE INDEX parking_sessions_reservation ON parking_sessions(reservation_id);
  CREATE INDEX parking_allocations_reservation ON parking_allocations(reservation_id);
  CREATE INDEX parking_charging_sessions_reservation ON parking_charging_sessions(reservation_id);
  CREATE INDEX parking_scan_events_reservation ON parking_scan_events(reservation_id, at);
  CREATE INDEX parking_occupancy_events_space ON parking_occupancy_events(space_id, at);
  CREATE INDEX parking_notifications_site ON parking_notifications(site_id, open, at);
  CREATE INDEX parking_audit_entity ON parking_audit(entity_id, at);
  CREATE INDEX parking_vehicles_resident ON parking_vehicles(resident_id);
  CREATE INDEX parking_associations_resident ON parking_associations(resident_id);
  `,  `
  -- Time series (series/): one row per quarter hour, keyed by the compound's or the unit's series_key and
  -- slot = floor(epoch ms / 900 000). Values are scaled integers (x10 = one decimal). source 0 = simulated (the
  -- generator, demo sites only), 1 = live. Rows may exist ahead of time; the API never serves a slot after now.
  CREATE TABLE bms_readings (
    site_key INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    source INTEGER NOT NULL,
    kw_x10 INTEGER NOT NULL,
    kwh_x10 INTEGER NOT NULL,
    solar_kw_x10 INTEGER NOT NULL,
    solar_kwh_x10 INTEGER NOT NULL,
    grid_cost INTEGER NOT NULL,
    solar_saving INTEGER NOT NULL,
    mdb_volts INTEGER NOT NULL,
    mdb_amps_x10 INTEGER NOT NULL,
    generator INTEGER NOT NULL,
    fuel_pct INTEGER NOT NULL,
    water_tank_pct INTEGER NOT NULL,
    water_flow_x10 INTEGER NOT NULL,
    pumps INTEGER NOT NULL,
    co2_ppm INTEGER NOT NULL,
    temp_x10 INTEGER NOT NULL,
    humidity_pct INTEGER NOT NULL,
    fans INTEGER NOT NULL,
    net_down_kbps INTEGER NOT NULL,
    net_up_kbps INTEGER NOT NULL,
    ping_ms INTEGER NOT NULL,
    uptime_x100 INTEGER NOT NULL,
    cameras_online INTEGER NOT NULL,
    cameras_total INTEGER NOT NULL,
    elevator_state INTEGER NOT NULL,
    elevator_floor INTEGER NOT NULL,
    fire_panel INTEGER NOT NULL,
    gates INTEGER NOT NULL,
    fault_code INTEGER NOT NULL,
    PRIMARY KEY (site_key, slot)
  ) WITHOUT ROWID;
  CREATE TABLE unit_energy (
    unit_key INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    source INTEGER NOT NULL,
    total_wh INTEGER NOT NULL,
    lighting_wh INTEGER NOT NULL,
    ac_wh INTEGER NOT NULL,
    media_wh INTEGER NOT NULL,
    other_wh INTEGER NOT NULL,
    PRIMARY KEY (unit_key, slot)
  ) WITHOUT ROWID;
  `,  `
  -- References (REQ-2026-00001, INV-…, RCP-…, PCL-…, BK-…) are unique across every compound, so their numbers come
  -- from one counter per kind and year (scope '*'), carried on from the highest each compound had reached.
  INSERT INTO reference_counters (site_id, kind, year, next)
    SELECT '*', kind, year, MAX(next) FROM reference_counters WHERE site_id != '*' GROUP BY kind, year
    ON CONFLICT(site_id, kind, year) DO UPDATE SET next = MAX(next, excluded.next);
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
