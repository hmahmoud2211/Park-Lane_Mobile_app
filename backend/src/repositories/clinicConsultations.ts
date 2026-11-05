import { db } from '../ems/db.ts';

/**
 * The clinic_consultations, clinic_transcript_segments and clinic_addenda
 * tables: a visit's clinical record, its transcript and later corrections.
 * Clinical text is sealed by the caller; this module only sees the sealed text.
 */

export type ConsultationStatus = 'draft' | 'final';

export interface ConsultationRow {
  id: string;
  appointment_id: string;
  doctor_id: string;
  patient_profile_id: string | null;
  status: ConsultationStatus;
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

/** A finalized consultation with its visit's time and doctor: what a history entry is made from. */
export interface FinalConsultationRow {
  id: string;
  appointment_id: string;
  doctor_id: string;
  final: string;
  finalized_at: string;
  ai_used: number;
  starts_at: string;
  display_name: string;
  display_name_ar: string | null;
  specialty_en: string;
  specialty_ar: string;
}

export interface PatientConsultationRow extends FinalConsultationRow {
  patient_profile_id: string | null;
  booked_by: string;
  patient_name: string;
  title: string | null;
  approved_by: string | null;
}

export interface DoctorHistoryRow extends FinalConsultationRow {
  patient_name: string;
  patient_profile_id: string | null;
}

export interface SegmentRow {
  id: string;
  seq: number;
  duration_ms: number | null;
  language: string | null;
  content: string;
  created_at: string;
}

/** Columns updateDraftIfVersion() may set, besides the version and updated_at. */
export type DraftColumn = 'notes' | 'draft' | 'transcript_edited' | 'ai_used';

// ---- Consultations ------------------------------------------------------------------------

export function findConsultation(id: string): ConsultationRow | null {
  return (db().prepare('SELECT * FROM clinic_consultations WHERE id = ?').get(id) as ConsultationRow | undefined) ?? null;
}

export function findConsultationForAppointment(appointmentId: string): ConsultationRow | undefined {
  return db().prepare('SELECT * FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as ConsultationRow | undefined;
}

export function findConsultationIdForAppointment(appointmentId: string): string | undefined {
  const row = db().prepare('SELECT id FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as { id: string } | undefined;
  return row?.id;
}

export function findConsultationRef(appointmentId: string): { id: string; status: ConsultationStatus } | null {
  return (
    (db().prepare('SELECT id, status FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as
      | { id: string; status: ConsultationStatus }
      | undefined) ?? null
  );
}

/** A first draft. Ignored if the appointment already has a consultation, so two clicks make one. */
export function insertConsultationIfMissing(consultation: {
  id: string;
  appointmentId: string;
  doctorId: string;
  patientProfileId: string | null;
  at: string;
}): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO clinic_consultations (id, appointment_id, doctor_id, patient_profile_id, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1, ?, ?)`,
    )
    .run(consultation.id, consultation.appointmentId, consultation.doctorId, consultation.patientProfileId, consultation.at, consultation.at);
}

/** Sets the given columns and moves the version on, if the draft is still at `version`. False when it is not. */
export function updateDraftIfVersion(id: string, version: number, changes: Partial<Record<DraftColumn, string | number | null>>, updatedAt: string): boolean {
  const columns = Object.keys(changes) as DraftColumn[];
  const result = db()
    .prepare(
      `UPDATE clinic_consultations SET ${[...columns.map((column) => `${column} = ?`), 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE id = ? AND version = ? AND status = 'draft'`,
    )
    .run(...columns.map((column) => changes[column] as string | number | null), updatedAt, id, version);
  return Number(result.changes) === 1;
}

export function setRecordingConsent(id: string, at: string): void {
  db().prepare('UPDATE clinic_consultations SET recording_consent_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
}

/** The AI's proposal, beside the doctor's draft; the version moves on so other tabs notice. */
export function saveAiDraft(id: string, aiDraft: string, at: string): void {
  db()
    .prepare('UPDATE clinic_consultations SET ai_draft = ?, ai_generated_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ?')
    .run(aiDraft, at, at, id, 'draft');
}

/** The approved note becomes both the final record and the draft. `aiApplied` 1 marks the record AI-assisted; 0 leaves it as it was. */
export function markConsultationFinal(consultation: { id: string; note: string; finalizedBy: string; aiApplied: 0 | 1; at: string }): void {
  db()
    .prepare(
      `UPDATE clinic_consultations SET status = 'final', final = ?, draft = ?, finalized_at = ?, finalized_by = ?,
         ai_used = CASE WHEN ? = 1 THEN 1 ELSE ai_used END, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .run(consultation.note, consultation.note, consultation.at, consultation.finalizedBy, consultation.aiApplied, consultation.at, consultation.id);
}

export function setPassportSynced(id: string, at: string): void {
  db().prepare('UPDATE clinic_consultations SET passport_synced_at = ? WHERE id = ?').run(at, id);
}

/** Finalized before `cutoff`, and not purged yet. */
export function listConsultationsDueForPurge(cutoff: string): { id: string; appointment_id: string; patient_profile_id: string | null }[] {
  return db()
    .prepare("SELECT id, appointment_id, patient_profile_id FROM clinic_consultations WHERE status = 'final' AND finalized_at < ? AND content_purged_at IS NULL")
    .all(cutoff) as { id: string; appointment_id: string; patient_profile_id: string | null }[];
}

export function purgeConsultationContent(id: string, at: string): void {
  db().prepare('UPDATE clinic_consultations SET transcript_edited = NULL, ai_draft = NULL, content_purged_at = ? WHERE id = ?').run(at, id);
}

// ---- Finalized consultations, with their visit --------------------------------------------

/** A patient's, newest visit first; `doctorId` keeps only that doctor's. */
export function listFinalConsultations(profileId: string, doctorId: string | null, limit: number): FinalConsultationRow[] {
  return db()
    .prepare(
      `SELECT c.id, c.appointment_id, c.doctor_id, c.final, c.finalized_at, c.ai_used, a.starts_at,
              d.display_name, d.display_name_ar, s.name_en AS specialty_en, s.name_ar AS specialty_ar
       FROM clinic_consultations c
       JOIN clinic_appointments a ON a.id = c.appointment_id
       JOIN clinic_doctors d ON d.id = c.doctor_id
       JOIN clinic_specialties s ON s.id = d.specialty_id
       WHERE c.patient_profile_id = ? AND c.status = 'final' ${doctorId ? 'AND c.doctor_id = ?' : ''}
       ORDER BY a.starts_at DESC LIMIT ?`,
    )
    .all(...(doctorId ? [profileId, doctorId, limit] : [profileId, limit])) as unknown as FinalConsultationRow[];
}

/** One finalized consultation with who booked it and who approved it; drafts are not found. */
export function findPatientConsultation(id: string): PatientConsultationRow | undefined {
  return db()
    .prepare(
      `SELECT c.id, c.appointment_id, c.doctor_id, c.final, c.finalized_at, c.ai_used, c.patient_profile_id,
              a.starts_at, a.booked_by, a.patient_name, d.display_name, d.display_name_ar, d.title,
              s.name_en AS specialty_en, s.name_ar AS specialty_ar, u.name AS approved_by
       FROM clinic_consultations c
       JOIN clinic_appointments a ON a.id = c.appointment_id
       JOIN clinic_doctors d ON d.id = c.doctor_id
       JOIN clinic_specialties s ON s.id = d.specialty_id
       LEFT JOIN users u ON u.id = c.finalized_by
       WHERE c.id = ? AND c.status = 'final'`,
    )
    .get(id) as PatientConsultationRow | undefined;
}

/** A doctor's, most recently finalized first. */
export function listDoctorHistory(doctorId: string, limit: number): DoctorHistoryRow[] {
  return db()
    .prepare(
      `SELECT c.id, c.appointment_id, c.doctor_id, c.final, c.finalized_at, c.ai_used, a.starts_at, a.patient_name,
              a.patient_profile_id, d.display_name, d.display_name_ar, s.name_en AS specialty_en, s.name_ar AS specialty_ar
       FROM clinic_consultations c
       JOIN clinic_appointments a ON a.id = c.appointment_id
       JOIN clinic_doctors d ON d.id = c.doctor_id
       JOIN clinic_specialties s ON s.id = d.specialty_id
       WHERE c.doctor_id = ? AND c.status = 'final' ORDER BY c.finalized_at DESC LIMIT ?`,
    )
    .all(doctorId, limit) as unknown as DoctorHistoryRow[];
}

// ---- Transcript segments ------------------------------------------------------------------

export function listTranscriptSegments(consultationId: string): SegmentRow[] {
  return db()
    .prepare('SELECT id, seq, duration_ms, language, content, created_at FROM clinic_transcript_segments WHERE consultation_id = ? ORDER BY seq')
    .all(consultationId) as unknown as SegmentRow[];
}

/** Ignored if this segment number is already stored, so a retried upload changes nothing. */
export function insertSegmentIfMissing(segment: {
  id: string;
  consultationId: string;
  seq: number;
  durationMs: number | null;
  language: string | null;
  content: string;
  createdAt: string;
}): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO clinic_transcript_segments (id, consultation_id, seq, duration_ms, language, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(segment.id, segment.consultationId, segment.seq, segment.durationMs, segment.language, segment.content, segment.createdAt);
}

/** False when the consultation has no such segment. */
export function deleteTranscriptSegment(id: string, consultationId: string): boolean {
  const result = db().prepare('DELETE FROM clinic_transcript_segments WHERE id = ? AND consultation_id = ?').run(id, consultationId);
  return Number(result.changes) === 1;
}

export function deleteConsultationSegments(consultationId: string): void {
  db().prepare('DELETE FROM clinic_transcript_segments WHERE consultation_id = ?').run(consultationId);
}

// ---- Addenda ------------------------------------------------------------------------------

/** The consultation's addenda with their ids, for the doctor's own view. */
export function listAddenda(consultationId: string): { id: string; text: string; created_at: string; author: string }[] {
  return db()
    .prepare(
      `SELECT a.id, a.text, a.created_at, u.name AS author FROM clinic_addenda a JOIN users u ON u.id = a.author_id
       WHERE a.consultation_id = ? ORDER BY a.created_at`,
    )
    .all(consultationId) as { id: string; text: string; created_at: string; author: string }[];
}

/** The same without ids: a history entry shows these rows as they are, and ids are not part of it. */
export function listAddendaForHistory(consultationId: string): { text: string; created_at: string; author: string }[] {
  return db()
    .prepare(
      `SELECT a.text, a.created_at, u.name AS author FROM clinic_addenda a JOIN users u ON u.id = a.author_id
       WHERE a.consultation_id = ? ORDER BY a.created_at`,
    )
    .all(consultationId) as { text: string; created_at: string; author: string }[];
}

export function insertAddendum(addendum: { id: string; consultationId: string; authorId: string; text: string; createdAt: string }): void {
  db()
    .prepare('INSERT INTO clinic_addenda (id, consultation_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(addendum.id, addendum.consultationId, addendum.authorId, addendum.text, addendum.createdAt);
}
