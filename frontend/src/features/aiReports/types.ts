import type { AiReportReason } from '../../../../shared/contracts/aiReports';

/**
 * The words of the "Report" button and its sheet. English is the default (ReportAnswer's `reportCopyEn`);
 * Health Passport passes its own English and Arabic (features/health/services/i18n.ts, `t.report`).
 */
export interface ReportCopy {
  /** The small button under an answer. */
  button: string;
  /** What a screen reader says for it, e.g. "Report this answer". */
  buttonA11y: string;
  /** After it was sent: the button stays, saying so. */
  sentButton: string;
  title: string;
  body: string;
  /** The reasons, in the order shown, in plain words. */
  reasons: Record<AiReportReason, string>;
  noteLabel: string;
  notePlaceholder: string;
  send: string;
  cancel: string;
  /** Shown in the sheet after sending. */
  thanks: string;
  done: string;
  tryAgain: string;
  errors: {
    /** No connection, or it took too long. */
    network: string;
    /** Too many reports in a short time. */
    busy: string;
    /** This build has no server address. */
    unavailable: string;
    other: string;
  };
}

/** The sheet's request, as far as the person has got. */
export type ReportPhase = 'idle' | 'sending' | 'sent' | 'failed';
