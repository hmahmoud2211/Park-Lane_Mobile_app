import { randomUUID } from 'node:crypto';

import { synthesize } from '../clinic/speech.ts';
import { ageAt } from '../clinic/time.ts';
import { ApiError } from '../errors.ts';
import { db } from '../ems/db.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { log } from '../log.ts';
import { readStoredFile, removeFiles, signedUrl, storeFile } from './files.ts';
import { enqueue, isWaiting } from './jobs.ts';
import { gapsFor, ownedProfile, profileById, readSections, type HealthLang } from './passport.ts';
import { buildFacts, specialtyName, writeSpokenSummary } from './spoken.ts';

/**
 * Health Passport's "Summary for doctor": the spoken handover (spoken.ts),
 * recorded by ElevenLabs, that the resident plays to their doctor. One per
 * profile, language and specialty; made in the background (waiting, then
 * writing, then recording) and reused while the record is unchanged. The
 * app's contract is SummaryState in src/services/health/health.types.ts.
 */

/** The specialties the app offers (src/services/health/i18n.ts, SPECIALTIES). */
const SPECIALTIES = new Set([
  'general', 'internal_medicine', 'cardiology', 'endocrinology', 'pediatrics', 'orthopedics', 'neurology',
  'gastroenterology', 'dermatology', 'gynecology', 'ophthalmology', 'ent', 'urology', 'psychiatry', 'pulmonology',
]);

/** The app's own wording (src/services/health/mockData.ts). */
const FAILED_TEXT: Record<HealthLang, string> = {
  en: 'The summary couldn’t be finished. Please try again.',
  ar: 'تعذّر إكمال الملخص. يرجى المحاولة مرة أخرى.',
};

interface SummaryRow {
  id: string;
  profile_id: string;
  lang: HealthLang;
  specialty: string;
  status: 'generating' | 'ready' | 'failed';
  phase: 'waiting' | 'writing' | 'recording' | null;
  record_updated_at: string;
  transcript: string | null;
  audio_file: string | null;
  error_code: string | null;
  started_at: string;
  generated_at: string | null;
  failed_at: string | null;
}

const now = () => new Date().toISOString();
const jobKey = (id: string) => `summary:${id}`;

function slot(profileId: string, lang: HealthLang, specialty: string): SummaryRow | null {
  return (
    (db().prepare('SELECT * FROM health_summaries WHERE profile_id = ? AND lang = ? AND specialty = ?').get(profileId, lang, specialty) as
      | SummaryRow
      | undefined) ?? null
  );
}

function present(row: SummaryRow, lang: HealthLang, base: string, cached = false) {
  if (row.status === 'generating') {
    return {
      status: 'generating' as const,
      lang: row.lang,
      specialty: row.specialty,
      started_at: row.started_at,
      phase: isWaiting(jobKey(row.id)) ? 'waiting' : (row.phase ?? 'waiting'),
    };
  }
  if (row.status === 'failed') {
    return {
      status: 'failed' as const,
      lang: row.lang,
      specialty: row.specialty,
      started_at: row.started_at,
      error: FAILED_TEXT[lang],
      failed_at: row.failed_at ?? row.started_at,
    };
  }
  return {
    status: 'ready' as const,
    lang: row.lang,
    specialty: row.specialty,
    transcript: row.transcript ? unseal(row.transcript) : '',
    audio_url: signedUrl(base, `/health/media/summary/${row.id}`),
    cached,
    generated_at: row.generated_at ?? row.started_at,
    record_updated_at: row.record_updated_at,
  };
}

/** GET .../summary: one specialty's, or without one the newest in the language. Null: none yet (404). */
export function getSummary(userId: string, profileId: string, lang: HealthLang, specialty: string | null, uiLang: HealthLang, base: string) {
  ownedProfile(userId, profileId);
  const row = specialty
    ? slot(profileId, lang, specialty)
    : ((db()
        .prepare(
          `SELECT * FROM health_summaries WHERE profile_id = ? AND lang = ?
           ORDER BY MAX(started_at, COALESCE(generated_at, ''), COALESCE(failed_at, '')) DESC LIMIT 1`,
        )
        .get(profileId, lang) as SummaryRow | undefined) ?? null);
  return row ? present(row, uiLang, base) : null;
}

/**
 * POST .../summary: a summary already made from the record as it is now
 * comes back at once (`cached`); one being made is returned as it is;
 * otherwise a new one starts in the background.
 */
export function requestSummary(userId: string, profileId: string, body: Record<string, unknown>, uiLang: HealthLang, base: string) {
  const profile = ownedProfile(userId, profileId);
  if (body.consent !== true) throw new ApiError('invalid', 'Consent is required to generate a summary.', 'consent');
  if (body.lang !== 'en' && body.lang !== 'ar') throw new ApiError('invalid', 'lang must be en or ar.', 'lang');
  const lang: HealthLang = body.lang;
  const specialty = typeof body.specialty === 'string' && body.specialty ? body.specialty : 'general';
  if (!SPECIALTIES.has(specialty)) throw new ApiError('invalid', 'Unknown specialty.', 'specialty');

  const existing = slot(profileId, lang, specialty);
  if (existing?.status === 'generating') return { state: present(existing, uiLang, base), status: 202 };
  if (existing?.status === 'ready' && existing.record_updated_at === profile.record_updated_at) {
    return { state: present(existing, uiLang, base, true), status: 200 };
  }
  const at = now();
  const id = existing?.id ?? randomUUID();
  db()
    .prepare(
      `INSERT INTO health_summaries (id, profile_id, lang, specialty, status, phase, record_updated_at, started_at)
       VALUES (?, ?, ?, ?, 'generating', 'waiting', ?, ?)
       ON CONFLICT(profile_id, lang, specialty) DO UPDATE SET status = 'generating', phase = 'waiting',
         record_updated_at = excluded.record_updated_at, started_at = excluded.started_at, error_code = NULL`,
    )
    .run(id, profileId, lang, specialty, profile.record_updated_at, at);
  queueSummary(id);
  return { state: present(slot(profileId, lang, specialty) as SummaryRow, uiLang, base), status: 202 };
}

export function queueSummary(id: string): void {
  enqueue(jobKey(id), () => makeSummary(id));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The background job: write the script from the record, check it, record it. */
async function makeSummary(id: string): Promise<void> {
  const row = db().prepare('SELECT * FROM health_summaries WHERE id = ?').get(id) as SummaryRow | undefined;
  if (!row || row.status !== 'generating') return;
  const setPhase = (phase: 'writing' | 'recording') => db().prepare('UPDATE health_summaries SET phase = ? WHERE id = ?').run(phase, id);
  try {
    const profile = profileById(row.profile_id);
    if (!profile) return;
    setPhase('writing');
    const sections = readSections(profile.id);
    const facts = buildFacts(
      { first_name: firstName(profile.name), sex: profile.sex, age: ageAt(profile.date_of_birth, Date.now()), blood_type: profile.blood_type },
      sections,
      { en: gapsFor(profile, sections, 'en'), ar: gapsFor(profile, sections, 'ar') },
    );
    const script = await writeSpokenSummary(facts, row.lang, specialtyName(row.specialty), 'passport_summary');
    setPhase('recording');
    const audio = await synthesize(script, row.lang);
    const file = storeFile(audio);
    db()
      .prepare(
        `UPDATE health_summaries SET status = 'ready', phase = NULL, transcript = ?, audio_file = ?, generated_at = ?, failed_at = NULL
         WHERE id = ? AND status = 'generating'`,
      )
      .run(seal(script), file, now(), id);
    if (row.audio_file) removeFiles([row.audio_file]);
  } catch (error) {
    log.warn('Health summary failed', { reason: error instanceof ApiError ? error.code : 'unexpected' });
    db()
      .prepare("UPDATE health_summaries SET status = 'failed', phase = NULL, error_code = ?, failed_at = ? WHERE id = ?")
      .run(error instanceof ApiError ? error.code : 'internal', now(), id);
  }
}

/** The recording, for the resident who owns it. */
export function summaryAudio(id: string): Buffer | null {
  const row = db().prepare("SELECT audio_file FROM health_summaries WHERE id = ? AND status = 'ready'").get(id) as { audio_file: string | null } | undefined;
  return row?.audio_file ? readStoredFile(row.audio_file) : null;
}

export function summaryOwner(id: string): string | null {
  const row = db()
    .prepare('SELECT p.owner_id FROM health_summaries s JOIN health_profiles p ON p.id = s.profile_id WHERE s.id = ?')
    .get(id) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}

/** After a restart: summaries still being made are made again. */
export function resumeSummaries(): number {
  const rows = db().prepare("SELECT id FROM health_summaries WHERE status = 'generating'").all() as { id: string }[];
  rows.forEach((row) => queueSummary(row.id));
  return rows.length;
}
