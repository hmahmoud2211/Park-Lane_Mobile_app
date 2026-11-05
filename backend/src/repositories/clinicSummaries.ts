import { db } from '../ems/db.ts';

/** The clinic_history_summaries and clinic_spoken_summaries tables: a visit's AI summaries, sealed by the caller and kept until they expire. */

export function findHistorySummary(appointmentId: string, lang: string, nowMs: number): { content: string; source_hash: string } | undefined {
  return db()
    .prepare('SELECT content, source_hash FROM clinic_history_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, nowMs) as { content: string; source_hash: string } | undefined;
}

export function upsertHistorySummary(summary: {
  appointmentId: string;
  lang: string;
  content: string;
  sourceHash: string;
  generatedAt: string;
  expiresAt: number;
}): void {
  db()
    .prepare(
      `INSERT INTO clinic_history_summaries (appointment_id, lang, content, source_hash, generated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(appointment_id, lang) DO UPDATE SET content = excluded.content, source_hash = excluded.source_hash,
         generated_at = excluded.generated_at, expires_at = excluded.expires_at`,
    )
    .run(summary.appointmentId, summary.lang, summary.content, summary.sourceHash, summary.generatedAt, summary.expiresAt);
}

export function deleteHistorySummaries(appointmentId: string): void {
  db().prepare('DELETE FROM clinic_history_summaries WHERE appointment_id = ?').run(appointmentId);
}

export function deleteExpiredHistorySummaries(nowMs: number): void {
  db().prepare('DELETE FROM clinic_history_summaries WHERE expires_at < ?').run(nowMs);
}

export function findSpokenSummary(appointmentId: string, lang: string, nowMs: number): { script: string; source_hash: string } | undefined {
  return db()
    .prepare('SELECT script, source_hash FROM clinic_spoken_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, nowMs) as { script: string; source_hash: string } | undefined;
}

export function findSpokenScript(appointmentId: string, lang: string, nowMs: number): { script: string } | undefined {
  return db()
    .prepare('SELECT script FROM clinic_spoken_summaries WHERE appointment_id = ? AND lang = ? AND expires_at > ?')
    .get(appointmentId, lang, nowMs) as { script: string } | undefined;
}

export function upsertSpokenSummary(summary: { appointmentId: string; lang: string; script: string; sourceHash: string; expiresAt: number }): void {
  db()
    .prepare(
      `INSERT INTO clinic_spoken_summaries (appointment_id, lang, script, source_hash, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(appointment_id, lang) DO UPDATE SET script = excluded.script, source_hash = excluded.source_hash, expires_at = excluded.expires_at`,
    )
    .run(summary.appointmentId, summary.lang, summary.script, summary.sourceHash, summary.expiresAt);
}

export function deleteSpokenSummaries(appointmentId: string): void {
  db().prepare('DELETE FROM clinic_spoken_summaries WHERE appointment_id = ?').run(appointmentId);
}

export function deleteExpiredSpokenSummaries(nowMs: number): void {
  db().prepare('DELETE FROM clinic_spoken_summaries WHERE expires_at < ?').run(nowMs);
}
