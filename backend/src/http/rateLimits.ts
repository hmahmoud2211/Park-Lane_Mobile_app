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
} as const satisfies Record<string, { max: number; windowMs: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Counts one request from `who` against the named limit, or throws 429. */
export function throttle(name: RateLimitName, who: string): void {
  const { max, windowMs } = RATE_LIMITS[name];
  limit(name, who, max, windowMs);
}
