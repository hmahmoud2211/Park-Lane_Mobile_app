import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { User } from '../ems/auth.ts';
import { transaction } from '../ems/db.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { cleanItem, consentGiven, insertItem, profileById, readSections, touch } from '../health/passport.ts';
import { completeAppointment } from '../repositories/clinicAppointments.ts';
import {
  deleteConsultationSegments,
  findConsultation,
  findConsultationForAppointment,
  findConsultationIdForAppointment,
  insertAddendum,
  insertConsultationIfMissing,
  listAddenda,
  listConsultationsDueForPurge,
  listDoctorHistory,
  markConsultationFinal,
  purgeConsultationContent,
  saveAiDraft,
  setPassportSynced,
  updateDraftIfVersion,
  type ConsultationRow,
  type DraftColumn,
} from '../repositories/clinicConsultations.ts';
import { deleteExpiredHistorySummaries, deleteExpiredSpokenSummaries } from '../repositories/clinicSummaries.ts';
import { countHealthItemsFromSource } from '../repositories/healthItems.ts';
import { findUserName } from '../repositories/users.ts';
import { draftFromDictation, type NoteDraft } from './ai/dictation.ts';
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
import { keytermsFrom, transcribe, type SpeechLang } from '../integrations/elevenlabs.ts';
import { addDays, ageAt, clinicDate } from './time.ts';

/**
 * A consultation: from "Start consultation" to the doctor's approval.
 *
 *   draft ──(doctor saves, as often as needed)──▶ draft ──finalize──▶ final
 *
 * The draft is the doctor's working copy, saved with an optimistic
 * `version`, so two tabs or a retried save can never overwrite newer work.
 * The doctor can dictate the note: the clip is transcribed, the AI sorts it
 * into the diagnosis, medications and investigations, and that proposal is
 * kept beside the draft, never in it, until the doctor puts it in the
 * editor. Finalizing is one transaction: the approved note, the
 * appointment's completion and the Health Passport entries are written
 * together or not at all, and finalizing again changes nothing.
 */

export interface ConsultationView {
  id: string;
  status: 'draft' | 'final';
  version: number;
  appointment: StaffAppointment;
  draft: ClinicalNote;
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

const open = <T>(value: string | null, fallback: T): T => (value ? (JSON.parse(unseal(value)) as T) : fallback);

function addenda(consultationId: string): ConsultationView['addenda'] {
  return listAddenda(consultationId).map((entry) => ({ ...entry, text: unseal(entry.text) }));
}

function view(consultation: ConsultationRow): ConsultationView {
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  const finalizer = consultation.finalized_by ? findUserName(consultation.finalized_by) : null;
  return {
    id: consultation.id,
    status: consultation.status,
    version: consultation.version,
    appointment: staffView(appointment),
    draft: open(consultation.draft, emptyNote()),
    ai_draft: open<NoteDraft | null>(consultation.ai_draft, null),
    final: open<ClinicalNote | null>(consultation.final, null),
    finalized_at: consultation.finalized_at,
    finalized_by: finalizer,
    ai_assisted: consultation.ai_used === 1,
    passport_synced: consultation.passport_synced_at !== null,
    content_purged: consultation.content_purged_at !== null,
    addenda: addenda(consultation.id),
  };
}

/** The doctor's own consultation, or 404. */
function ownConsultation(doctor: DoctorRow, id: string): ConsultationRow {
  const found = findConsultation(id);
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
  const existing = findConsultationIdForAppointment(appointmentId);
  if (appointment.status === 'checked_in' || appointment.status === 'waiting') {
    transition(actor, appointmentId, 'start');
  } else if (appointment.status !== 'in_consultation' && !(existing && appointment.status === 'completed')) {
    throw new ApiError('invalid_transition', 'Check the patient in before starting the consultation.');
  }
  if (!existing) {
    insertConsultationIfMissing({ id: randomUUID(), appointmentId, doctorId: doctor.id, patientProfileId: appointment.patient_profile_id, at: now() });
  }
  const consultation = findConsultationForAppointment(appointmentId) as ConsultationRow;
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
  const sets: Partial<Record<DraftColumn, string | number | null>> = {};
  if (body.draft !== undefined) sets.draft = seal(JSON.stringify(cleanNote(body.draft)));
  if (body.ai_applied === true) sets.ai_used = 1;
  if (!updateDraftIfVersion(id, body.version, sets, now())) {
    throw new ApiError('version_conflict', 'This draft was changed elsewhere. Reload it before saving again.');
  }
  audit({ actor: user, action: 'consultation.draft_saved', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(findConsultation(id) as ConsultationRow);
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
 * The doctor dictates the note: one clip, transcribed and then sorted by
 * the AI into the diagnosis, the medications and the investigations. The
 * audio is dropped once transcribed; the text heard is kept with the AI's
 * proposal so the doctor can check the fields against it, and both go
 * with the retention purge. Each dictation replaces the previous proposal;
 * the draft the doctor is editing is untouched until they apply it.
 */
export async function dictate(
  user: User,
  doctor: DoctorRow,
  id: string,
  audio: Buffer,
  meta: { mimeType: string; lang: SpeechLang; noteLang: 'en' | 'ar' },
): Promise<ConsultationView> {
  const consultation = ownConsultation(doctor, id);
  editable(consultation);
  if (!AUDIO_TYPES.test(meta.mimeType)) throw new ApiError('invalid', 'Upload the dictation as audio.', 'content-type');
  if (audio.length < 1_000) throw new ApiError('invalid', 'The dictation is too short to transcribe.', 'audio');
  const appointment = appointmentRow(consultation.appointment_id) as AppointmentRow;
  requireAiConsent(appointment);

  const heard = await transcribe(audio, meta.mimeType, { lang: meta.lang, keyterms: keyterms(appointment) });
  if (!heard.text.trim()) throw new ApiError('invalid', 'No speech was heard in the dictation. Try again, closer to the microphone.', 'audio');
  const draft = await draftFromDictation(
    {
      text: heard.text,
      context: {
        specialty: doctor.specialty_en,
        age: ageAt(appointment.patient_dob, Date.parse(appointment.starts_at)),
        sex: appointment.patient_sex,
        reason_given_when_booking: reasonOf(appointment),
      },
    },
    { text: heard.text, language: heard.language },
    meta.noteLang,
  );
  const at = now();
  // The draft the doctor is editing is untouched; a version bump tells other tabs something changed.
  saveAiDraft(id, seal(JSON.stringify(draft)), at);
  audit({
    actor: user,
    action: 'consultation.dictated',
    appointmentId: consultation.appointment_id,
    consultationId: id,
    patientProfileId: consultation.patient_profile_id,
    detail: { lang: meta.noteLang, heard: heard.language, flags: draft.flags.length },
  });
  return view(findConsultation(id) as ConsultationRow);
}

/** What finalizing writes into the Health Passport: a visit, and each prescribed medicine not already current there. */
function syncPassport(consultation: ConsultationRow, appointment: AppointmentRow, doctor: DoctorRow, note: ClinicalNote): boolean {
  const profile = consultation.patient_profile_id ? profileById(consultation.patient_profile_id) : null;
  if (!profile || !consentGiven(profile.owner_id)) return false;
  const source = `consultation:${consultation.id}`;
  if (countHealthItemsFromSource(source) > 0) return true;
  const date = clinicDate(Date.parse(appointment.starts_at));
  const diagnosis = note.diagnoses.map((entry) => entry.name).join(', ');
  // The clinic's note has no reason field any more: the reason given when booking stands in.
  const reason = note.chief_complaint || reasonOf(appointment) || '';
  insertItem(
    profile.id,
    'visits',
    cleanItem('visits', {
      date,
      specialty: doctor.specialty_en,
      reason: [reason, diagnosis].filter(Boolean).join(' — ') || diagnosis,
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
    markConsultationFinal({ id, note: seal(JSON.stringify(note)), finalizedBy: user.id, aiApplied: body.ai_applied === true ? 1 : 0, at });
    completeAppointment(appointment.id, at);
    const synced = syncPassport(consultation, appointment, doctor, note);
    if (synced) setPassportSynced(id, at);
    audit({
      actor: user,
      action: 'consultation.finalized',
      appointmentId: appointment.id,
      consultationId: id,
      patientProfileId: consultation.patient_profile_id,
      detail: { passport_synced: synced, medications: note.medications.length, diagnoses: note.diagnoses.length },
    });
    return findConsultation(id) as ConsultationRow;
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
  insertAddendum({ id: randomUUID(), consultationId: id, authorId: user.id, text: seal(text), createdAt: now() });
  audit({ actor: user, action: 'consultation.addendum', appointmentId: consultation.appointment_id, consultationId: id, patientProfileId: consultation.patient_profile_id });
  return view(findConsultation(id) as ConsultationRow);
}

/** The doctor's finalized consultations, newest first, searched by patient name. */
export function doctorHistory(doctor: DoctorRow, filters: { q?: string | null; limit?: number }) {
  const rows = listDoctorHistory(doctor.id, Math.min(filters.limit ?? 200, 500));
  const query = (filters.q ?? '').trim().toLowerCase();
  return rows
    .filter((entry) => !query || entry.patient_name.toLowerCase().includes(query))
    .map((entry) => ({ ...entryOf(entry), patient: { name: entry.patient_name, profile_id: entry.patient_profile_id } }));
}

/**
 * Retention: some time after finalizing, the dictation text and the AI's
 * proposal are deleted (and any transcript segments from before dictation
 * replaced recording). The approved record and the audit trail stay.
 */
export function purgeExpiredContent(nowMs = Date.now()): number {
  const cutoff = new Date(nowMs - config.clinic.transcriptRetentionDays * 24 * 3600_000).toISOString();
  const due = listConsultationsDueForPurge(cutoff);
  for (const entry of due) {
    transaction(() => {
      deleteConsultationSegments(entry.id);
      purgeConsultationContent(entry.id, new Date(nowMs).toISOString());
      audit({ actor: null, action: 'consultation.purged', appointmentId: entry.appointment_id, consultationId: entry.id, patientProfileId: entry.patient_profile_id });
    });
  }
  deleteExpiredHistorySummaries(nowMs);
  deleteExpiredSpokenSummaries(nowMs);
  return due.length;
}
