import type { AiReportReceipt, AiReportRequest } from '../../../../../shared/contracts/aiReports';
import { EmsError, call, getSessionToken } from '../../ems/services/emsHttp';

/**
 * Reporting an AI answer (backend/src/routes/aiReports.ts), as Google Play's AI-Generated Content policy asks:
 * from the assistant (chat and voice) and Health Passport, signed in or as a guest.
 */

/** The backend's limits (backend/src/aiReports/aiReports.ts). */
export const MAX_REPORT_NOTE = 500;
export const MAX_REPORT_EXCERPT = 4000;

/** The answer as it is sent: trimmed, and cut with an ellipsis when it is longer than the backend takes. */
export function excerptOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_REPORT_EXCERPT) return trimmed;
  let cut = trimmed.slice(0, MAX_REPORT_EXCERPT - 1);
  // Never end on half of an emoji or other character outside the basic plane.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Sends a report. Signed in, the session goes with it so building management knows who sent it; a guest sends none.
 * A refused session never signs anyone out here: the backend takes the report as a guest's instead.
 */
export function sendAiReport(report: AiReportRequest): Promise<AiReportReceipt> {
  const note = report.note?.trim().slice(0, MAX_REPORT_NOTE);
  return call<AiReportReceipt>('/api/ai-reports', {
    method: 'POST',
    body: { source: report.source, reason: report.reason, excerpt: excerptOf(report.excerpt), ...(note ? { note } : {}) },
    auth: getSessionToken() !== null,
    sessionCheck: false,
  });
}

export type ReportFailure = 'network' | 'busy' | 'unavailable' | 'other';

/** Which plain-words message a failed report gets. */
export function reportFailureOf(error: unknown): ReportFailure {
  if (!(error instanceof EmsError)) return 'other';
  switch (error.code) {
    case 'network':
    case 'timeout':
      return 'network';
    case 'rate_limited':
      return 'busy';
    case 'not_configured':
      return 'unavailable';
    default:
      return 'other';
  }
}
