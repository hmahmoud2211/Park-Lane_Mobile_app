/**
 * Visitor passes: GET | POST /api/visitors, POST /api/visitors/:id/revoke (residents of the unit);
 * POST /api/security/visitors/check, POST /api/security/visitors/:id/entry | /exit, GET /api/security/visitors/today
 * (gate staff and admins).
 */

/** `expired`: never used and past its window. `left`: a single-use pass after its visitor left. */
export type VisitorPassStatus = 'scheduled' | 'arrived' | 'left' | 'expired' | 'revoked';

export interface VisitorPass {
  id: string;
  visitorName: string;
  visitorPhone: string | null;
  plate: string | null;
  guests: number;
  arrivesAt: string;
  validFrom: string;
  validTo: string;
  uses: 'single' | 'multi';
  status: VisitorPassStatus;
  /** What the QR code holds; shown to the resident to share. */
  code: string;
  createdAt: string;
  createdByMe: boolean;
  entries: { kind: 'entry' | 'exit'; at: string }[];
}

export interface NewVisitorPass {
  visitorName: string;
  visitorPhone?: string | null;
  plate?: string | null;
  guests: number;
  /** The expected arrival, an ISO instant; inside the compound's visiting hours and booking window. */
  arrivesAt: string;
  uses?: 'single' | 'multi';
  /** Multi-use passes: the last day it works (YYYY-MM-DD, compound time). */
  lastDay?: string;
}

/** What the gate sees after scanning: never the resident's personal data beyond the unit's name. */
export interface GateCheck {
  decision: 'admit' | 'exit' | 'too_early' | 'expired' | 'revoked' | 'used' | 'unknown';
  pass: {
    id: string;
    visitorName: string;
    guests: number;
    plate: string | null;
    unitName: string;
    arrivesAt: string;
    validTo: string;
    status: VisitorPassStatus;
  } | null;
}
