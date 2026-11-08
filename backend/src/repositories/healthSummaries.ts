import { db } from '../ems/db.ts';

/** The health_summaries table: spoken summaries, one per profile, language and specialty. The transcript is sealed by the caller. */

export type SummaryPhase = 'waiting' | 'writing' | 'recording';

export interface SummaryRow {
  id: string;
  profile_id: string;
  lang: 'en' | 'ar';
  specialty: string;
  status: 'generating' | 'ready' | 'failed';
  phase: SummaryPhase | null;
  record_updated_at: string;
  transcript: string | null;
  audio_file: string | null;
  error_code: string | null;
  started_at: string;
  generated_at: string | null;
  failed_at: string | null;
}

export function findHealthSummary(id: string): SummaryRow | undefined {
  return db().prepare('SELECT * FROM health_summaries WHERE id = ?').get(id) as SummaryRow | undefined;
}

export function findSummaryForSpecialty(profileId: string, lang: string, specialty: string): SummaryRow | null {
  return (
    (db().prepare('SELECT * FROM health_summaries WHERE profile_id = ? AND lang = ? AND specialty = ?').get(profileId, lang, specialty) as
      | SummaryRow
      | undefined) ?? null
  );
}

/** The summary in this language that changed last, whatever its specialty. */
export function findNewestSummary(profileId: string, lang: string): SummaryRow | null {
  return (
    (db()
      .prepare(
        `SELECT * FROM health_summaries WHERE profile_id = ? AND lang = ?
         ORDER BY MAX(started_at, COALESCE(generated_at, ''), COALESCE(failed_at, '')) DESC LIMIT 1`,
      )
      .get(profileId, lang) as SummaryRow | undefined) ?? null
  );
}

export function findReadySummaryAudio(id: string): string | null {
  const row = db().prepare("SELECT audio_file FROM health_summaries WHERE id = ? AND status = 'ready'").get(id) as { audio_file: string | null } | undefined;
  return row?.audio_file ?? null;
}

export function listGeneratingSummaryIds(): string[] {
  return (db().prepare("SELECT id FROM health_summaries WHERE status = 'generating'").all() as { id: string }[]).map((row) => row.id);
}

/** Every recording in use, to tell which stored files are not. */
export function listSummaryAudioFiles(): string[] {
  return (db().prepare('SELECT audio_file FROM health_summaries WHERE audio_file IS NOT NULL').all() as { audio_file: string }[]).map((row) => row.audio_file);
}

/** Starts a summary in its slot, keeping the slot's row (and id) if it has one. */
export function upsertGeneratingSummary(summary: { id: string; profileId: string; lang: string; specialty: string; recordUpdatedAt: string; startedAt: string }): void {
  db()
    .prepare(
      `INSERT INTO health_summaries (id, profile_id, lang, specialty, status, phase, record_updated_at, started_at)
       VALUES (?, ?, ?, ?, 'generating', 'waiting', ?, ?)
       ON CONFLICT(profile_id, lang, specialty) DO UPDATE SET status = 'generating', phase = 'waiting',
         record_updated_at = excluded.record_updated_at, started_at = excluded.started_at, error_code = NULL`,
    )
    .run(summary.id, summary.profileId, summary.lang, summary.specialty, summary.recordUpdatedAt, summary.startedAt);
}

export function setSummaryPhase(id: string, phase: SummaryPhase): void {
  db().prepare('UPDATE health_summaries SET phase = ? WHERE id = ?').run(phase, id);
}

export function completeSummary(id: string, transcript: string, audioFile: string, generatedAt: string): void {
  db()
    .prepare(
      `UPDATE health_summaries SET status = 'ready', phase = NULL, transcript = ?, audio_file = ?, generated_at = ?, failed_at = NULL
       WHERE id = ? AND status = 'generating'`,
    )
    .run(transcript, audioFile, generatedAt, id);
}

export function failSummary(id: string, errorCode: string, failedAt: string): void {
  db().prepare("UPDATE health_summaries SET status = 'failed', phase = NULL, error_code = ?, failed_at = ? WHERE id = ?").run(errorCode, failedAt, id);
}

export function deleteProfileSummaries(profileId: string): void {
  db().prepare('DELETE FROM health_summaries WHERE profile_id = ?').run(profileId);
}
