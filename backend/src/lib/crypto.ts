import { timingSafeEqual } from 'node:crypto';

/** Compares a secret someone sent with the expected one in constant time. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
