import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { User } from '../ems/auth.ts';
import { db, transaction } from '../ems/db.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { cleanItem, consentGiven, insertItem, profileById, readSections, touch } from '../health/passport.ts';
import { draftNote, type NoteDraft } from './ai/noteDraft.ts';
import { audit } from './audit.ts';
import {
  afterChange,
  appointmentFor,
  appointmentRow,
  reasonOf,
  staffView,
  transition,
  type Actor,
  type AppointmentRow,
  type StaffAppointment,
} from './appointments.ts';
import type { DoctorRow } from './doctors.ts';
import { broadcast } from './events.ts';
import { accessFor, entryOf } from './history.ts';
import { assertFinalizable, cleanNote, emptyNote, type ClinicalNote } from './note.ts';
import { keytermsFrom, transcribe, type SpeechLang, type Utterance } from './speech.ts';
import { addDays, ageAt, clinicDate } from './time.ts';

/**
 * A consultation: from "Start consultation" to the doctor's approval.
 *
 *   draft ──(doctor saves, as often as needed)──▶ draft ──finalize──▶ final
 *
 * The draft is the doctor's working copy, saved with an optimistic
 * `version`, so two tabs or a retried save can never overwrite newer work.
 * The AI's proposal is kept beside it, never in it, until the doctor puts it
 * in the editor. Finalizing is one transaction: the approved note, the
 * appointment's completion and the Health Passport entries are written
 * together or not at all, and finalizing again changes nothing.
 */

interface ConsultationRow {
  id: string;
  appointment_id: string;
  doctor_id: string;
  patient_profile_id: string | null;
  status: 'draft' | 'final';
  version: number;
  recording_consent_at: string | null;
  notes: string | null;
  draft: string | null;
  transcript_edited: string | null;
  ai_draft: string | null;
  ai_generated_at: string | null;
  ai_used: number;
  final: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  passport_synced_at: string | null;
  content_purged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Segment {
  id: string;
  seq: number;
  duration_ms: number | null;
  language: string | null;
  text: string;
  utterances: Utterance[];
  created_at: string;
}

export interface ConsultationView {
  id: string;
  status: 'draft' | 'final';
  version: number;
  appointment: StaffAppointment;
  recording_consent_at: string | null;
  notes: string;
  draft: ClinicalNote;
  transcript: { segments: Segment[]; edited: string | null };
  ai_draft: NoteDraft | null;
  final: ClinicalNote | null;
  finalized_at: string | null;
  finalized_by: string | null;
  ai_assisted: boolean;
  /** Whether the approved record reached the patient's Health Passport. */
  passport_synced: boolean;
  content_purged: boolean;
  addenda: { id: string; text: string; created_at: string; author: string }[];
}

const now = () => new Date().toISOString();

function row(id: string): ConsultationRow | null {
  return (db().prepare('SELECT * FROM clinic_consultations WHERE id = ?').get(id) as ConsultationRow | undefined) ?? null;
}

const open = <T>(value: string | null, fallback: T): T => (value ? (JSON.parse(unseal(value)) as T) : fallback);

function segmentsOf(consultationId: string): Segment[] {
  const rows = db()
    .prepare('SELECT id, seq, duration_ms, language, content, created_at FROM clinic_transcript_segments WHERE consultation_id = ? ORDER BY seq')
    .all(consultationId) as { id: string; seq: number; duration_ms: number | null; language: string | null; content: string; created_at: string }[];
  return rows.map(({ content, ...rest }) => ({ ...rest, ...(JSON.parse(unseal(content)) as { text: string; utterances: Utterance[] }) }));
}

function addenda(consultationId: string): ConsultationView['addenda'] {
  const rows = db()
    .prepare(
      `SELECT a.id, a.text, a.created_at, u.name AS author FROM clinic_addenda a JOIN users u ON u.id = a.author_id
       WHERE a.consultation_id = ? ORDER BY a.created_at`,
    )
    .all(consultationId) as { id: string; text: string; created_at: string; author: string }[];
  return rows.map((entry) => ({ ...entry, text: unseal(entry.text) }));
}

function view(consultation: ConsultationRow): ConsultationView {
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  const finalizer = consultation.finalized_by
    ? (db().prepare('SELECT name FROM users WHERE id = ?').get(consultation.finalized_by) as { name: string } | undefined)
    : undefined;
  return {
    id: consultation.id,
    status: consultation.status,
    version: consultation.version,
    appointment: staffView(appointment),
    recording_consent_at: consultation.recording_consent_at,
    notes: consultation.notes ? unseal(consultation.notes) : '',
    draft: open(consultation.draft, emptyNote()),
    transcript: {
      segments: segmentsOf(consultation.id),
      edited: consultation.transcript_edited ? unseal(consultation.transcript_edited) : null,
    },
    ai_draft: open<NoteDraft | null>(consultation.ai_draft, null),
    final: open<ClinicalNote | null>(consultation.final, null),
    finalized_at: consultation.finalized_at,
    finalized_by: finalizer?.name ?? null,
    ai_assisted: consultation.ai_used === 1,
    passport_synced: consultation.passport_synced_at !== null,
    content_purged: consultation.content_purged_at !== null,
    addenda: addenda(consultation.id),
  };
}

/** The doctor's own consultation, or 404. */
function ownConsultation(doctor: DoctorRow, id: string): ConsultationRow {
  const found = row(id);
  if (!found || found.doctor_id !== doctor.id) throw new ApiError('not_found', 'Consultation not found.');
  return found;
}

function editable(consultation: ConsultationRow): void {
  if (consultation.status !== 'draft') {
    throw new ApiError('invalid_transition', 'This consultation is finalized. Add an addendum to correct it.');
  }
}

const actorOf = (user: User, doctor: DoctorRow): Actor => ({ user, doctorId: doctor.id });

/**
 * "Start consultation": the appointment moves into consultation and its
 * draft is created, or the existing one is reopened. Opening a finalized
 * consultation shows it read-only.
 */
export function openConsultation(user: User, doctor: DoctorRow, appointmentId: string): ConsultationView {
  const actor = actorOf(user, doctor);
  const appointment = appointmentFor(actor, appointmentId);
  const existing = db().prepare('SELECT id FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as { id: string } | undefined;
  if (appointment.status === 'checked_in' || appointment.status === 'waiting') {
    transition(actor, appointmentId, 'start');
  } else if (appointment.status !== 'in_consultation' && !(existing && appointment.status === 'completed')) {
    throw new ApiError('invalid_transition', 'Check the patient in before starting the consultation.');
  }
  if (!existing) {
    const at = now();
    const id = randomUUID();
    // INSERT OR IGNORE: two clicks on "Start" make one consultation.
    db()
      .prepare(
        `INSERT OR IGNORE INTO clinic_consultations (id, appointment_id, doctor_id, patient_profile_id, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?)`,
      )
      .run(id, appointmentId, doctor.id, appointment.patient_profile_id, at, at);
  }
  const consultation = db().prepare('SELECT * FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as unknown as ConsultationRow;
  audit({ actor: user, action: 'consultation.opened', appointmentId, consultationId: consultation.id, patientProfileId: appointment.patient_profile_id });
  return view(consultation);
}

export function getConsultation(user: User, doctor: DoctorRow, id: string): ConsultationView {
  const consultation = ownConsultation(doctor, id);
  audit({ actor: user, action: 'consultation.viewed', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(consultation);
}

/** Saves the draft if `version` is still current; otherwise 409, and the caller reloads. */
export function saveDraft(user: User, doctor: DoctorRow, id: string, body: Record<string, unknown>): ConsultationView {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  if (typeof body.version !== 'number') throw new ApiError('invalid', 'version is required.', 'version');
  const sets: Record<string, string | number | null> = {};
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') throw new ApiError('invalid', 'notes must be text.', 'notes');
    sets.notes = body.notes ? seal(body.notes.slice(0, 50_000)) : null;
  }
  if (body.draft !== undefined) sets.draft = seal(JSON.stringify(cleanNote(body.draft)));
  if (body.transcript_edited !== undefined) {
    if (body.transcript_edited !== null && typeof body.transcript_edited !== 'string') {
      throw new ApiError('invalid', 'transcript_edited must be text.', 'transcript_edited');
    }
    sets.transcript_edited = body.transcript_edited ? seal(body.transcript_edited.slice(0, 200_000)) : null;
  }
  if (body.ai_applied === true) sets.ai_used = 1;
  const columns = Object.keys(sets);
  const result = db()
    .prepare(
      `UPDATE clinic_consultations SET ${[...columns.map((column) => `${column} = ?`), 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE id = ? AND version = ? AND status = 'draft'`,
    )
    .run(...columns.map((column) => sets[column]), now(), id, body.version);
  if (Number(result.changes) !== 1) {
    throw new ApiError('version_conflict', 'This draft was changed elsewhere. Reload it before saving again.');
  }
  audit({ actor: user, action: 'consultation.draft_saved', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(row(id) as ConsultationRow);
}

/**
 * The doctor confirms the patient agreed, in the room, to being recorded.
 * Recording also needs AI consent for the visit (the resident's, or one the
 * doctor records in person), since the audio goes to a transcription service.
 */
export function recordRecordingConsent(user: User, doctor: DoctorRow, id: string): ConsultationView {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  if (appointment.ai_consent !== 1) {
    throw new ApiError('consent_required', 'Record the patient’s consent to AI assistance for this visit first.');
  }
  if (!consultation.recording_consent_at) {
    db().prepare('UPDATE clinic_consultations SET recording_consent_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
    audit({ actor: user, action: 'consultation.recording_consent', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  }
  return view(row(id) as ConsultationRow);
}

function requireAiConsent(appointment: AppointmentRow) {
  if (appointment.ai_consent !== 1) {
    throw new ApiError('consent_required', 'The patient has not agreed to AI assistance for this visit.');
  }
}

/** Medicines and conditions the doctor may see, as Scribe key terms. */
function keyterms(appointment: AppointmentRow): string[] {
  if (accessFor(appointment).level !== 'full' || !appointment.patient_profile_id) return [];
  const sections = readSections(appointment.patient_profile_id);
  return keytermsFrom([...sections.medications.map((item) => item.name), ...sections.conditions.map((item) => item.name)]);
}

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac)(;.*)?$/;

/**
 * One recorded segment: transcribed and stored as text, the audio dropped.
 * Uploading a segment number again returns what was already transcribed,
 * so a retry after a lost connection is never transcribed (or billed) twice.
 */
export async function addSegment(
  user: User,
  doctor: DoctorRow,
  id: string,
  audio: Buffer,
  meta: { seq: number; mimeType: string; lang: SpeechLang; durationMs: number | null },
): Promise<{ segment: Segment; duplicate: boolean }> {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  if (!Number.isInteger(meta.seq) || meta.seq < 0 || meta.seq > 10_000) throw new ApiError('invalid', 'seq must be a segment number.', 'seq');
  if (!AUDIO_TYPES.test(meta.mimeType)) throw new ApiError('invalid', 'Upload the segment as audio.', 'content-type');
  if (audio.length < 1_000) throw new ApiError('invalid', 'The segment is too short to transcribe.', 'audio');
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  requireAiConsent(appointment);
  if (!consultation.recording_consent_at) {
    throw new ApiError('consent_required', 'Confirm the patient agreed to being recorded before recording.');
  }
  const existing = segmentsOf(id).find((segment) => segment.seq === meta.seq);
  if (existing) return { segment: existing, duplicate: true };

  const result = await transcribe(audio, meta.mimeType, { lang: meta.lang, keyterms: keyterms(appointment) });
  const segmentId = randomUUID();
  const content = seal(JSON.stringify({ text: result.text, utterances: result.utterances }));
  db()
    .prepare(
      `INSERT OR IGNORE INTO clinic_transcript_segments (id, consultation_id, seq, duration_ms, language, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(segmentId, id, meta.seq, meta.durationMs, result.language, content, now());
  audit({
    actor: user,
    action: 'consultation.segment_transcribed',
    appointmentId: consultation.appointment_id,
    consultationId: id,
    patientProfileId: consultation.patient_profile_id,
    detail: { seq: meta.seq, empty: result.text === '' },
  });
  const stored = segmentsOf(id).find((segment) => segment.seq === meta.seq) as Segment;
  return { segment: stored, duplicate: stored.id !== segmentId };
}

export function removeSegment(user: User, doctor: DoctorRow, id: string, segmentId: string): ConsultationView {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  const result = db().prepare('DELETE FROM clinic_transcript_segments WHERE id = ? AND consultation_id = ?').run(segmentId, id);
  if (Number(result.changes) !== 1) throw new ApiError('not_found', 'Segment not found.');
  audit({ actor: user, action: 'consultation.segment_removed', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(row(id) as ConsultationRow);
}

const SPEAKER = /^speaker_(\d+)$/;

/** The transcript the AI reads: the doctor's corrected copy if there is one, else the segments with speaker labels. */
export function transcriptText(consultation: ConsultationRow): string {
  if (consultation.transcript_edited) return unseal(consultation.transcript_edited);
  return segmentsOf(consultation.id)
    .map((segment) =>
      [
        `[Segment ${segment.seq + 1}]`,
        ...segment.utterances.map((u) => `Speaker ${Number(SPEAKER.exec(u.speaker)?.[1] ?? 0) + 1}: ${u.text}`),
      ].join('\n'),
    )
    .join('\n\n');
}

/** Asks the AI for a draft note. Stored beside the doctor's draft; the editor decides what to use. */
export async function draftWithAi(user: User, doctor: DoctorRow, id: string, lang: 'en' | 'ar'): Promise<ConsultationView> {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  requireAiConsent(appointment);
  const transcript = transcriptText(consultation);
  const notes = consultation.notes ? unseal(consultation.notes) : '';
  if (!transcript.trim() && !notes.trim()) {
    throw new ApiError('invalid', 'There is nothing to summarize yet. Record the consultation or type notes first.');
  }
  const draft = await draftNote(
    {
      transcript,
      notes,
      context: {
        specialty: doctor.specialty_en,
        age: ageAt(appointment.patient_dob, Date.parse(appointment.starts_at)),
        sex: appointment.patient_sex,
        reason_given_when_booking: reasonOf(appointment),
      },
    },
    lang,
  );
  const at = now();
  // The draft the doctor is editing is untouched; a version bump tells other tabs something changed.
  db()
    .prepare('UPDATE clinic_consultations SET ai_draft = ?, ai_generated_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ?')
    .run(seal(JSON.stringify(draft)), at, at, id, 'draft');
  audit({
    actor: user,
    action: 'consultation.drafted_by_ai',
    appointmentId: consultation.appointment_id,
    consultationId: id,
    patientProfileId: consultation.patient_profile_id,
    detail: { lang, flags: draft.flags.length },
  });
  return view(row(id) as ConsultationRow);
}

/** What finalizing writes into the Health Passport: a visit, and each prescribed medicine not already current there. */
function syncPassport(consultation: ConsultationRow, appointment: AppointmentRow, doctor: DoctorRow, note: ClinicalNote): boolean {
  const profile = consultation.patient_profile_id ? profileById(consultation.patient_profile_id) : null;
  if (!profile || !consentGiven(profile.owner_id)) return false;
  const source = `consultation:${consultation.id}`;
  const already = db().prepare('SELECT COUNT(*) AS count FROM health_items WHERE source = ?').get(source) as { count: number };
  if (already.count > 0) return true;
  const date = clinicDate(Date.parse(appointment.starts_at));
  const diagnosis = note.diagnoses.map((entry) => entry.name).join(', ');
  insertItem(
    profile.id,
    'visits',
    cleanItem('visits', {
      date,
      specialty: doctor.specialty_en,
      reason: diagnosis ? `${note.chief_complaint} — ${diagnosis}` : note.chief_complaint,
    }),
    source,
  );
  const current = readSections(profile.id).medications.filter((item) => !item.end || String(item.end) >= date);
  const key = (name: unknown, dose: unknown) => `${String(name ?? '').trim().toLowerCase()}|${String(dose ?? '').trim().toLowerCase()}`;
  const held = new Set(current.map((item) => key(item.name, item.dose)));
  for (const med of note.medications) {
    if (held.has(key(med.name, med.dose))) continue;
    held.add(key(med.name, med.dose));
    insertItem(
      profile.id,
      'medications',
      cleanItem('medications', {
        name: med.name,
        dose: med.dose || null,
        frequency: med.frequency || null,
        start: date,
        end: med.duration_days ? addDays(date, med.duration_days - 1) : null,
      }),
      source,
    );
  }
  touch(profile.id);
  return true;
}

/**
 * The doctor approves the note. One transaction: the consultation becomes
 * final, the appointment completed, and the Health Passport gets the visit.
 * Asking again (a retry, a second click) returns the finalized consultation
 * and writes nothing, so there is never a second history entry.
 */
export function finalize(user: User, doctor: DoctorRow, id: string, body: Record<string, unknown>): ConsultationView & { already_finalized: boolean } {
  if (body.attest !== true) {
    throw new ApiError('invalid', 'Confirm that you have reviewed the record and that it is accurate.', 'attest');
  }
  const note = cleanNote(body.note);
  let already = false;
  const finished = transaction(() => {
    const consultation = ownConsultation(doctor, id);
    if (consultation.status === 'final') {
      already = true;
      return consultation;
    }
    if (body.version !== consultation.version) {
      throw new ApiError('version_conflict', 'This draft was changed elsewhere. Reload it and review again before approving.');
    }
    assertFinalizable(note);
    const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
    if (appointment.status !== 'in_consultation') {
      throw new ApiError('invalid_transition', 'Resume the consultation before finalizing it.');
    }
    const at = now();
    const sealed = seal(JSON.stringify(note));
    db()
      .prepare(
        `UPDATE clinic_consultations SET status = 'final', final = ?, draft = ?, finalized_at = ?, finalized_by = ?,
           ai_used = CASE WHEN ? = 1 THEN 1 ELSE ai_used END, version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(sealed, sealed, at, user.id, body.ai_applied === true ? 1 : 0, at, id);
    db()
      .prepare("UPDATE clinic_appointments SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'in_consultation'")
      .run(at, at, appointment.id);
    const synced = syncPassport(consultation, appointment, doctor, note);
    if (synced) db().prepare('UPDATE clinic_consultations SET passport_synced_at = ? WHERE id = ?').run(at, id);
    audit({
      actor: user,
      action: 'consultation.finalized',
      appointmentId: appointment.id,
      consultationId: id,
      patientProfileId: consultation.patient_profile_id,
      detail: { passport_synced: synced, medications: note.medications.length, diagnoses: note.diagnoses.length },
    });
    return row(id) as ConsultationRow;
  });
  if (!already) {
    const appointment = appointmentRow(finished.appointment_id) as AppointmentRow;
    afterChange(appointment);
    broadcast(
      { kind: 'consultation_final', appointment_id: appointment.id, consultation_id: id, doctor_id: doctor.id },
      { doctorUserId: doctor.user_id, residentId: appointment.booked_by },
    );
  }
  return { ...view(finished), already_finalized: already };
}

/** A signed, dated correction to a finalized record, which itself never changes. */
export function addAddendum(user: User, doctor: DoctorRow, id: string, body: Record<string, unknown>): ConsultationView {
  const consultation = ownConsultation(doctor, id);
  if (consultation.status !== 'final') throw new ApiError('invalid_transition', 'Edit the draft instead: it is not finalized yet.');
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4_000) : '';
  if (!text) throw new ApiError('invalid', 'Write the addendum first.', 'text');
  db()
    .prepare('INSERT INTO clinic_addenda (id, consultation_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), id, user.id, seal(text), now());
  audit({ actor: user, action: 'consultation.addendum', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(row(id) as ConsultationRow);
}

/** The doctor's finalized consultations, newest first, searched by patient name. */
export function doctorHistory(doctor: DoctorRow, filters: { q?: string | null; limit?: number }) {
  const rows = db()
    .prepare(
      `SELECT c.id, c.appointment_id, c.doctor_id, c.final, c.finalized_at, c.ai_used, a.starts_at, a.patient_name,
              a.patient_profile_id, d.display_name, d.display_name_ar, s.name_en AS specialty_en, s.name_ar AS specialty_ar
       FROM clinic_consultations c
       JOIN clinic_appointments a ON a.id = c.appointment_id
       JOIN clinic_doctors d ON d.id = c.doctor_id
       JOIN clinic_specialties s ON s.id = d.specialty_id
       WHERE c.doctor_id = ? AND c.status = 'final' ORDER BY c.finalized_at DESC LIMIT ?`,
    )
    .all(doctor.id, Math.min(filters.limit ?? 200, 500)) as unknown as (Parameters<typeof entryOf>[0] & {
    patient_name: string;
    patient_profile_id: string | null;
  })[];
  const query = (filters.q ?? '').trim().toLowerCase();
  return rows
    .filter((entry) => !query || entry.patient_name.toLowerCase().includes(query))
    .map((entry) => ({ ...entryOf(entry), patient: { name: entry.patient_name, profile_id: entry.patient_profile_id } }));
}

/**
 * Retention: some time after finalizing, the transcript and the AI's draft
 * are deleted. The approved record, the doctor's notes and the audit trail stay.
 */
export function purgeExpiredContent(nowMs = Date.now()): number {
  const cutoff = new Date(nowMs - config.clinic.transcriptRetentionDays * 24 * 3600_000).toISOString();
  const due = db()
    .prepare("SELECT id, appointment_id, patient_profile_id FROM clinic_consultations WHERE status = 'final' AND finalized_at < ? AND content_purged_at IS NULL")
    .all(cutoff) as { id: string; appointment_id: string; patient_profile_id: string | null }[];
  for (const entry of due) {
    transaction(() => {
      db().prepare('DELETE FROM clinic_transcript_segments WHERE consultation_id = ?').run(entry.id);
      db()
        .prepare('UPDATE clinic_consultations SET transcript_edited = NULL, ai_draft = NULL, content_purged_at = ? WHERE id = ?')
        .run(new Date(nowMs).toISOString(), entry.id);
      audit({ actor: null, action: 'consultation.purged', appointmentId: entry.appointment_id, consultationId: entry.id, patientProfileId: entry.patient_profile_id });
    });
  }
  db().prepare('DELETE FROM clinic_history_summaries WHERE expires_at < ?').run(nowMs);
  return due.length;
}
