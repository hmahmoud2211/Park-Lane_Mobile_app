import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';

/**
 * Fixed-window limits kept in memory, enough for a single backend process.
 * Keys combine a bucket name with the caller (IP or user), so a flood on
 * login does not block device commands.
 */

const windows = new Map<string, { count: number; resetAt: number }>();
const SWEEP_AT = 10_000;

export function limit(bucket: string, who: string, max: number, windowMs: number): void {
  const now = Date.now();
  const key = `${bucket}:${who}`;
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > SWEEP_AT) {
      for (const [entry, value] of windows) {
        if (value.resetAt <= now) {
          windows.delete(entry);
        }
      }
      // Still full (a flood of new callers): drop the oldest windows, so memory stays bounded.
      for (const entry of windows.keys()) {
        if (windows.size <= SWEEP_AT / 2) break;
        windows.delete(entry);
      }
    }
    return;
  }
  current.count += 1;
  if (current.count > max) {
    throw new ApiError('rate_limited', 'Too many requests. Wait a moment and try again.');
  }
}

/** An IPv6 caller is limited by its /64, which one home or phone gets whole; an IPv4 one by its address. */
export function limitKeyOf(address: string): string {
  const ip = address.replace(/^::ffff:(?=\d+\.)/i, '');
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * The caller's address for rate limits. Behind our proxies (TRUST_PROXY=1): Cloudflare's CF-Connecting-IP, which it
 * always sets itself, whatever the caller sent; otherwise the right-most X-Forwarded-For entry, the one our own proxy
 * added. The left-most entry is whatever the caller wrote, so it would let anyone pick a fresh address per request.
 */
export function clientIp(req: IncomingMessage): string {
  let address = '';
  if (config.ems.trustProxy) {
    const cloudflare = req.headers['cf-connecting-ip'];
    const hops = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    address = (typeof cloudflare === 'string' ? cloudflare.trim() : '') || hops[hops.length - 1] || '';
  }
  return limitKeyOf(address || req.socket.remoteAddress || 'unknown');
}

/** Tests start from a clean slate. */
export function resetLimits(): void {
  windows.clear();
}
