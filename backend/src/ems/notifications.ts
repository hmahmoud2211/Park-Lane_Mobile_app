import { randomUUID } from 'node:crypto';

import type { AppNotification, NotificationKind, NotificationPage, NotificationPrefs } from '../../../shared/contracts/notifications.ts';
import { ApiError } from '../errors.ts';
import {
  countUnread,
  deleteNotificationsBefore,
  insertNotification,
  listNotifications,
  markRead,
  readPrefs,
  writePref,
  type NotificationRow,
} from '../repositories/notifications.ts';
import { publish } from './events.ts';

/**
 * The in-app inbox. Features call notify() when something changes for a resident (a request was assigned, a
 * parcel arrived…); the resident sees it in the app at once (realtime `notification.new`) and in the inbox later.
 * A kind the resident turned off is not stored or sent. Push notifications to the phone are not part of this.
 */

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['requests', 'visitors', 'parcels', 'bookings', 'community', 'bills', 'parking', 'account'];

const isKind = (value: unknown): value is NotificationKind => typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);

/** Kept this long, then removed by the hourly upkeep. */
const RETENTION_DAYS = 180;

const present = (row: NotificationRow): AppNotification => ({
  id: row.id,
  kind: isKind(row.kind) ? row.kind : 'account',
  title: row.title,
  body: row.body,
  ref: row.ref_type && row.ref_id ? { type: row.ref_type, id: row.ref_id } : null,
  createdAt: row.created_at,
  readAt: row.read_at,
});

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  ref?: { type: string; id: string } | null;
}

/** Tells each user, unless they turned that kind off. Returns how many were told. */
export function notify(userIds: Iterable<string>, input: NotificationInput, at = new Date().toISOString()): number {
  let told = 0;
  for (const userId of new Set(userIds)) {
    if (readPrefs(userId).get(input.kind) === false) continue;
    const row: NotificationRow = {
      id: randomUUID(),
      user_id: userId,
      kind: input.kind,
      title: input.title.slice(0, 140),
      body: input.body ? input.body.slice(0, 500) : null,
      ref_type: input.ref?.type ?? null,
      ref_id: input.ref?.id ?? null,
      created_at: at,
      read_at: null,
    };
    insertNotification(row);
    publish(userId, { type: 'notification.new', notification: present(row), unread: countUnread(userId) });
    told += 1;
  }
  return told;
}

export function inbox(userId: string, query: URLSearchParams): NotificationPage {
  const limit = Math.min(Math.max(Number(query.get('limit')) || 30, 1), 100);
  const before = query.get('before');
  if (before !== null && Number.isNaN(Date.parse(before))) throw new ApiError('bad_request', 'before must be a time.');
  const rows = listNotifications(userId, limit + 1, before);
  const items = rows.slice(0, limit).map(present);
  return { items, unread: countUnread(userId), next: rows.length > limit ? items[items.length - 1].createdAt : null };
}

/** `{ ids: [...] }` or `{ all: true }`. */
export function markInboxRead(userId: string, body: Record<string, unknown>, at = new Date().toISOString()): { unread: number } {
  if (body.all === true) {
    markRead(userId, 'all', at);
  } else if (Array.isArray(body.ids) && body.ids.length <= 200 && body.ids.every((id) => typeof id === 'string')) {
    markRead(userId, body.ids as string[], at);
  } else {
    throw new ApiError('bad_request', 'Send { ids: [...] } or { all: true }.');
  }
  return { unread: countUnread(userId) };
}

export function prefsOf(userId: string): NotificationPrefs {
  const stored = readPrefs(userId);
  return Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, stored.get(kind) ?? true])) as NotificationPrefs;
}

/** `{ requests: false, … }`; kinds left out keep their setting. */
export function updatePrefs(userId: string, body: Record<string, unknown>): NotificationPrefs {
  for (const [kind, enabled] of Object.entries(body)) {
    if (!isKind(kind) || typeof enabled !== 'boolean') throw new ApiError('bad_request', `Unknown setting: ${kind}.`);
  }
  for (const [kind, enabled] of Object.entries(body)) writePref(userId, kind, enabled as boolean);
  return prefsOf(userId);
}

export function purgeOldNotifications(nowMs = Date.now()): number {
  return deleteNotificationsBefore(new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString());
}
