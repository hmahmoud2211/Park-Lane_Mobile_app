import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { User } from '../ems/auth.ts';
import { db } from '../ems/db.ts';
import { seal, sha256, unseal } from '../ems/secrets.ts';
import { gapsFor, profileById, type HealthLang, type RecordSections } from '../health/passport.ts';
import { buildFacts, writeSpokenSummary } from '../health/spoken.ts';
import { buildInput, summarizeHistory, type HistorySummary } from './ai/historySummary.ts';
import { appointmentFor, reasonOf, type AppointmentRow } from './appointments.ts';
import { audit } from './audit.ts';
import type { DoctorRow } from './doctors.ts';
import { accessFor, patientHistory } from './history.ts';
import { speechParts, synthesizePart } from './speech.ts';

/**
 * AI history summaries for one appointment: made on the doctor's request,
 * kept sealed until a day after the visit, and remade when the underlying
 * records change. They need both of the resident's choices for the visit:
 * sharing the Health Passport, and AI assistance.
 */

function requireSummaryConsent(appointment: AppointmentRow): void {
  if (accessFor(appointment).level !== 'full') {
    throw new ApiError('consent_required', 'The patient has not shared their Health Passport for this visit.');
  }
  if (appointment.ai_consent !== 1) {
    throw new ApiError('consent_required', 'The patient has not agreed to AI assistance for this visit.');
  }
}

function stored(appointmentId: string, lang: HealthLang): { summary: HistorySummary; hash: string } | null {
  const row = db()
    .prepare('SELECT content, source_hash FROM clinic_history_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, Date.now()) as { content: string; source_hash: string } | undefined;
  return row ? { summary: JSON.parse(unseal(row.content)) as HistorySummary, hash: row.source_hash } : null;
}

export function latestSummary(user: User, doctor: DoctorRow, appointmentId: string, lang: HealthLang): HistorySummary | null {
  const appointment = appointmentFor({ user, doctorId: doctor.id }, appointmentId);
  if (accessFor(appointment).level !== 'full' || appointment.ai_consent !== 1) return null;
  const found = stored(appointmentId, lang);
  if (found) {
    audit({ actor: user, action: 'history.summary_viewed', appointmentId, patientProfileId: appointment.patient_profile_id, detail: { lang } });
  }
  return found?.summary ?? null;
}

/**
 * A summary of the records as they are now. One already made from exactly
 * these records comes back as stored (`cached`), without calling the AI again.
 */
export async function generateSummary(
  user: User,
  doctor: DoctorRow,
  appointmentId: string,
  lang: HealthLang,
): Promise<HistorySummary & { cached: boolean }> {
  const appointment = appointmentFor({ user, doctorId: doctor.id }, appointmentId);
  requireSummaryConsent(appointment);
  const history = patientHistory(doctor, appointment);
  const visit = { specialty: doctor.specialty_en, reason: reasonOf(appointment) };
  const previous = stored(appointmentId, lang);
  if (previous && previous.hash === buildInput(history, visit).hash) {
    audit({ actor: user, action: 'history.summary_viewed', appointmentId, patientProfileId: appointment.patient_profile_id, detail: { lang } });
    return { ...previous.summary, cached: true };
  }
  const { summary, hash } = await summarizeHistory(history, visit, lang);
  const expiresAt = Date.parse(appointment.ends_at) + config.clinic.historySummaryTtlMs;
  db()
    .prepare(
      `INSERT INTO clinic_history_summaries (appointment_id, lang, content, source_hash, generated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(appointment_id, lang) DO UPDATE SET content = excluded.content, source_hash = excluded.source_hash,
         generated_at = excluded.generated_at, expires_at = excluded.expires_at`,
    )
    .run(appointmentId, lang, seal(JSON.stringify(summary)), hash, summary.generated_at, Math.max(expiresAt, Date.now() + 3600_000));
  audit({
    actor: user,
    action: 'history.summarized',
    appointmentId,
    patientProfileId: appointment.patient_profile_id,
    detail: { lang, ai: !summary.empty_history, removed: summary.removed_unsupported },
  });
  return { ...summary, cached: false };
}

/** What the doctor's browser needs to fetch the spoken handover part by part. */
export interface SpokenPlan {
  /** Names this script; a part asked for with another one answers version_conflict. */
  version: string;
  /** Characters in each part, in order: how many parts there are, and roughly how long each plays. */
  parts: number[];
}

/**
 * "Listen to summary": the spoken handover of the shared record
 * (health/spoken.ts), focused on the doctor's specialty, read by ElevenLabs.
 * The checked script is kept, sealed, until a day after the visit, and made
 * again only when the record changes; the audio itself is never stored.
 *
 * Listening takes two steps, so no single request waits for everything:
 * this one writes (or reuses) the script and says how it is split, then
 * the browser fetches each part's audio with speakSummaryPart, playing the
 * first while the next ones are made.
 */
export async function prepareSpokenSummary(user: User, doctor: DoctorRow, appointmentId: string, lang: HealthLang): Promise<SpokenPlan> {
  const appointment = appointmentFor({ user, doctorId: doctor.id }, appointmentId);
  requireSummaryConsent(appointment);
  const history = patientHistory(doctor, appointment);
  const profile = appointment.patient_profile_id ? profileById(appointment.patient_profile_id) : null;
  if (!history.passport || !profile) throw new ApiError('consent_required', 'The patient has not shared their Health Passport for this visit.');
  const sections = Object.fromEntries(
    Object.entries(history.passport.sections).map(([section, items]) => [section, items.map(({ provenance: _provenance, ...item }) => item)]),
  ) as RecordSections;
  const facts = buildFacts(
    { first_name: appointment.patient_name.trim().split(/\s+/)[0], sex: appointment.patient_sex, age: history.patient.age, blood_type: history.patient.blood_type },
    sections,
    { en: gapsFor(profile, sections, 'en'), ar: gapsFor(profile, sections, 'ar') },
  );
  const specialty = doctor.specialty_en.toLowerCase();
  const hash = sha256(JSON.stringify({ facts, specialty }));
  const stored = db()
    .prepare('SELECT script, source_hash FROM clinic_spoken_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, Date.now()) as { script: string; source_hash: string } | undefined;
  let script = stored?.source_hash === hash ? unseal(stored.script) : null;
  if (!script) {
    script = await writeSpokenSummary(facts, lang, specialty, 'clinic_spoken_summary');
    db()
      .prepare(
        `INSERT INTO clinic_spoken_summaries (appointment_id, lang, script, source_hash, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(appointment_id, lang) DO UPDATE SET script = excluded.script, source_hash = excluded.source_hash, expires_at = excluded.expires_at`,
      )
      .run(appointmentId, lang, seal(script), hash, Math.max(Date.parse(appointment.ends_at) + config.clinic.historySummaryTtlMs, Date.now() + 3600_000));
  }
  audit({ actor: user, action: 'history.spoken', appointmentId, patientProfileId: appointment.patient_profile_id, detail: { lang } });
  return { version: spokenVersion(script), parts: speechParts(script).map((part) => part.length) };
}

const spokenVersion = (script: string) => sha256(script).slice(0, 16);

/** MP3 of one part of the script prepareSpokenSummary made; the same consent rules apply to every part. */
export async function speakSummaryPart(
  user: User,
  doctor: DoctorRow,
  appointmentId: string,
  lang: HealthLang,
  index: number,
  version: string,
): Promise<Buffer> {
  const appointment = appointmentFor({ user, doctorId: doctor.id }, appointmentId);
  requireSummaryConsent(appointment);
  const stored = db()
    .prepare('SELECT script FROM clinic_spoken_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, Date.now()) as { script: string } | undefined;
  if (!stored) throw new ApiError('not_found', 'The spoken summary has expired. Listen again.');
  const script = unseal(stored.script);
  if (spokenVersion(script) !== version) throw new ApiError('version_conflict', 'The summary was rewritten since this started. Listen again.');
  const parts = speechParts(script);
  if (!Number.isInteger(index) || index < 0 || index >= parts.length) throw new ApiError('not_found', 'No such part of the summary.');
  return synthesizePart(parts[index], lang);
}
