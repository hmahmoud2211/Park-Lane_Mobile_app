import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';

/**
 * Fixed-window limits kept in memory, enough for a single backend process.
 * Keys combine a bucket name with the caller (IP or user), so a flood on
 * login does not block device commands.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

export function limit(bucket: string, who: string, max: number, windowMs: number): void {
  const now = Date.now();
  const key = `${bucket}:${who}`;
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) {
      for (const [entry, value] of windows) {
        if (value.resetAt <= now) {
          windows.delete(entry);
        }
      }
    }
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new ApiError('rate_limited', 'Too many requests. Wait a moment and try again.');
  }
}

export function clientIp(req: IncomingMessage): string {
  // X-Forwarded-For is whatever the caller wrote unless a proxy we run overwrote it.
  const forwarded = config.ems.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return forwarded || req.socket.remoteAddress || 'unknown';
}

/** Tests start from a clean slate. */
export function resetLimits(): void {
  windows.clear();
}
