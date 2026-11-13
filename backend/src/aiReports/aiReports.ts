import { randomUUID } from 'node:crypto';

import type {
  AdminAiReportView,
  AiReportReason,
  AiReportReceipt,
  AiReportSource,
  AiReportStatus,
} from '../../../shared/contracts/aiReports.ts';
import type { User } from '../ems/auth.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { findAiReport, insertAiReport, listAiReports, markAiReportReviewed, type AdminAiReportRow } from '../repositories/aiReports.ts';
import { findUnitOfUser } from '../repositories/units.ts';

/**
 * Reports of AI-generated content (Google Play's AI-Generated Content policy): anyone using the app flags an answer
 * from the Parklane Assistant (chat or voice) or Health Passport (a spoken summary, or the AI's reading of a
 * document) without leaving the app, and building management reviews them on the dashboard.
 *
 * Guests can report too, so a report needs no account: a signed-in report carries the person and their apartment,
 * a guest's carries neither. The excerpt can hold health information, so it is sealed at rest like the note, and
 * never logged. A person's reports are deleted with their account (ai_reports.user_id ON DELETE CASCADE, and
 * repositories/accountDeletion.ts for an account row that is kept).
 */

export const AI_REPORT_SOURCES: readonly AiReportSource[] = ['assistant', 'assistant_voice', 'health_summary', 'health_review'];
export const AI_REPORT_REASONS: readonly AiReportReason[] = ['offensive', 'harmful', 'wrong', 'other'];
export const MAX_NOTE = 500;
export const MAX_EXCERPT = 4000;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

function oneOf<T extends string>(value: unknown, list: readonly T[], field: string, message: string): T {
  return list.includes(value as T) ? (value as T) : invalid(field, message);
}

/** Saves a report from `user`, or from a guest when null. */
export function submitAiReport(user: User | null, body: Record<string, unknown>, nowMs = Date.now()): AiReportReceipt {
  const source = oneOf(body.source, AI_REPORT_SOURCES, 'source', 'Say where the answer was shown.');
  const reason = oneOf(body.reason, AI_REPORT_REASONS, 'reason', 'Choose a reason.');
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') invalid('note', 'The note must be text.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE) invalid('note', `Keep the note to ${MAX_NOTE} characters.`);
  const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
  if (!excerpt) invalid('excerpt', 'Send the answer you are reporting.');
  if (excerpt.length > MAX_EXCERPT) invalid('excerpt', `The answer can be at most ${MAX_EXCERPT} characters.`);

  const receivedAt = new Date(nowMs).toISOString();
  const id = randomUUID();
  insertAiReport({
    id,
    user_id: user?.id ?? null,
    unit_id: user ? (findUnitOfUser(user.id)?.id ?? null) : null,
    source,
    reason,
    note: note ? seal(note) : null,
    excerpt: seal(excerpt),
    status: 'new',
    created_at: receivedAt,
    reviewed_at: null,
  });
  // What was reported stays out of the log: only that a report came in.
  log.info('ai report received', { id, source, reason, signedIn: user !== null });
  return { id, receivedAt };
}

function present(row: AdminAiReportRow): AdminAiReportView {
  return {
    id: row.id,
    source: row.source,
    reason: row.reason,
    note: row.note ? unseal(row.note) : null,
    excerpt: unseal(row.excerpt),
    status: row.status,
    signedIn: row.user_id !== null,
    fromName: row.from_name,
    unitName: row.unit_name,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

/** Building management's list; `?status=new|reviewed`, anything else lists both. */
export function adminAiReports(statusInput: string | null): AdminAiReportView[] {
  const status: AiReportStatus | null = statusInput === 'new' || statusInput === 'reviewed' ? statusInput : null;
  return listAiReports(status).map(present);
}

export function reviewAiReport(id: string, nowMs = Date.now()): AdminAiReportView {
  if (!markAiReportReviewed(id, new Date(nowMs).toISOString())) throw new ApiError('not_found', 'No such report.');
  return present(findAiReport(id) as AdminAiReportRow);
}
