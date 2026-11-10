import { limit } from '../ems/rateLimit.ts';

/**
 * Every rate limit on the API, per caller (IP before sign-in, the user after), in one
 * fixed window each. Exceeding one answers 429 `rate_limited`.
 */
export const RATE_LIMITS = {
  /** register and login, per IP */
  auth: { max: 10, windowMs: 60_000 },
  'assistant-token': { max: 20, windowMs: 60_000 },
  'device-command': { max: 60, windowMs: 60_000 },
  'account-flow': { max: 20, windowMs: 60_000 },
  'account-flow-step': { max: 60, windowMs: 60_000 },
  'account-refresh': { max: 6, windowMs: 60_000 },
  'room-create': { max: 20, windowMs: 60_000 },
  'gateway-pass': { max: 20, windowMs: 60_000 },
  'gateway-sync': { max: 30, windowMs: 60_000 },
  'unit-invite': { max: 20, windowMs: 3_600_000 },
  'unit-join': { max: 10, windowMs: 60_000 },
  'health-upload': { max: 20, windowMs: 3_600_000 },
  'health-summary': { max: 30, windowMs: 3_600_000 },
  'clinic-book': { max: 20, windowMs: 60_000 },
  /** Residents making visitor passes, per user. */
  'visitor-pass': { max: 30, windowMs: 3_600_000 },
  /** Gate staff checking codes, per staff account (or the API key). */
  'gate-check': { max: 120, windowMs: 60_000 },
  /** Management's uploads of unit documents, per admin. */
  'unit-document': { max: 60, windowMs: 3_600_000 },
  'service-request': { max: 20, windowMs: 3_600_000 },
  'request-photo': { max: 40, windowMs: 3_600_000 },
  'request-comment': { max: 60, windowMs: 3_600_000 },
  feedback: { max: 10, windowMs: 3_600_000 },
  'amenity-booking': { max: 30, windowMs: 3_600_000 },
  'parking-booking': { max: 30, windowMs: 3_600_000 },
  'parking-pass': { max: 60, windowMs: 60_000 },
  'parking-scan': { max: 120, windowMs: 60_000 },
  'clinic-ai': { max: 40, windowMs: 3_600_000 },
  'clinic-tts': { max: 40, windowMs: 3_600_000 },
  /** A listen is one prepare and a handful of parts. */
  'clinic-tts-part': { max: 600, windowMs: 3_600_000 },
  'clinic-stt': { max: 600, windowMs: 3_600_000 },
} as const satisfies Record<string, { max: number; windowMs: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Counts one request from `who` against the named limit, or throws 429. */
export function throttle(name: RateLimitName, who: string): void {
  const { max, windowMs } = RATE_LIMITS[name];
  limit(name, who, max, windowMs);
}
