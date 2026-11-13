import type { AiReportReason, AiReportSource, AiReportStatus } from '../../../shared/contracts/aiReports.ts';
import { db } from '../ems/db.ts';

/** Reports of AI-generated content (aiReports/aiReports.ts). `note` and `excerpt` are stored sealed. */

export interface AiReportRow {
  id: string;
  user_id: string | null;
  unit_id: string | null;
  source: AiReportSource;
  reason: AiReportReason;
  note: string | null;
  excerpt: string;
  status: AiReportStatus;
  created_at: string;
  reviewed_at: string | null;
}

export type AdminAiReportRow = AiReportRow & { from_name: string | null; unit_name: string | null };

export function insertAiReport(row: AiReportRow): void {
  db()
    .prepare(
      `INSERT INTO ai_reports (id, user_id, unit_id, source, reason, note, excerpt, status, created_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.user_id, row.unit_id, row.source, row.reason, row.note, row.excerpt, row.status, row.created_at, row.reviewed_at);
}

/** New ones first, then newest first; `status` narrows the list. */
export function listAiReports(status: AiReportStatus | null): AdminAiReportRow[] {
  return db()
    .prepare(
      `SELECT ai_reports.*, users.name AS from_name, units.name AS unit_name FROM ai_reports
       LEFT JOIN users ON users.id = ai_reports.user_id LEFT JOIN units ON units.id = ai_reports.unit_id
       ${status ? 'WHERE ai_reports.status = ?' : ''} ORDER BY ai_reports.status = 'new' DESC, ai_reports.created_at DESC LIMIT 300`,
    )
    .all(...(status ? [status] : [])) as unknown as AdminAiReportRow[];
}

export function findAiReport(id: string): AdminAiReportRow | undefined {
  return db()
    .prepare(
      `SELECT ai_reports.*, users.name AS from_name, units.name AS unit_name FROM ai_reports
       LEFT JOIN users ON users.id = ai_reports.user_id LEFT JOIN units ON units.id = ai_reports.unit_id
       WHERE ai_reports.id = ?`,
    )
    .get(id) as AdminAiReportRow | undefined;
}

/** Marks it reviewed once; a second call keeps the first time. */
export function markAiReportReviewed(id: string, at: string): boolean {
  return Number(db().prepare("UPDATE ai_reports SET status = 'reviewed', reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?").run(at, id).changes) > 0;
}
