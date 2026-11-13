/**
 * Reports of AI-generated content (Google Play's AI-Generated Content policy): anyone using the app, signed in
 * or a guest, flags an answer the AI gave without leaving the app.
 *   POST /api/ai-reports                      AiReportRequest -> AiReportReceipt
 *   GET  /api/admin/ai-reports?status=        AdminAiReportView[]   (building management)
 *   POST /api/admin/ai-reports/:id/reviewed   AdminAiReportView
 */

/** Where the AI text was shown. */
export type AiReportSource = 'assistant' | 'assistant_voice' | 'health_summary' | 'health_review';

/** Why it is reported: offensive or hurtful, could cause harm, wrong information, something else. */
export type AiReportReason = 'offensive' | 'harmful' | 'wrong' | 'other';

export type AiReportStatus = 'new' | 'reviewed';

export interface AiReportRequest {
  source: AiReportSource;
  reason: AiReportReason;
  /** The person's own words, up to 500 characters. */
  note?: string;
  /** The AI text being reported, 1 to 4000 characters (the app cuts longer answers). */
  excerpt: string;
}

export interface AiReportReceipt {
  id: string;
  receivedAt: string;
}

/** A report as building management reads it on the dashboard. */
export interface AdminAiReportView {
  id: string;
  source: AiReportSource;
  reason: AiReportReason;
  note: string | null;
  excerpt: string;
  status: AiReportStatus;
  /** False for a guest who was not signed in. */
  signedIn: boolean;
  fromName: string | null;
  unitName: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
