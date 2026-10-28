import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { User } from '../ems/auth.ts';
import { db } from '../ems/db.ts';
import { seal, unseal } from '../ems/secrets.ts';
import type { HealthLang } from '../health/passport.ts';
import { buildInput, speakableText, summarizeHistory, type HistorySummary } from './ai/historySummary.ts';
import { appointmentFor, reasonOf, type AppointmentRow } from './appointments.ts';
import { audit } from './audit.ts';
import type { DoctorRow } from './doctors.ts';
import { accessFor, patientHistory } from './history.ts';
import { synthesize } from './speech.ts';

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

/** The stored summary, read aloud. Only a summary the server made can be spoken, so nothing else reaches the voice service. */
export async function speakSummary(user: User, doctor: DoctorRow, appointmentId: string, lang: HealthLang): Promise<Buffer> {
  const appointment = appointmentFor({ user, doctorId: doctor.id }, appointmentId);
  requireSummaryConsent(appointment);
  const found = stored(appointmentId, lang);
  if (!found) throw new ApiError('not_found', 'Make the summary first, then listen to it.');
  const audio = await synthesize(speakableText(found.summary), lang);
  audit({ actor: user, action: 'history.spoken', appointmentId, patientProfileId: appointment.patient_profile_id, detail: { lang } });
  return audio;
}
