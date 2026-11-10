import { db } from '../ems/db.ts';

/** The notifications and notification_prefs tables: each resident's in-app inbox (ems/notifications.ts). */

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
  read_at: string | null;
}

export function insertNotification(row: NotificationRow): void {
  db()
    .prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, ref_type, ref_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(row.id, row.user_id, row.kind, row.title, row.body, row.ref_type, row.ref_id, row.created_at);
}

/** Newest first, `before` an ISO time for the next page. */
export function listNotifications(userId: string, limit: number, before: string | null): NotificationRow[] {
  return db()
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, before, before, limit) as unknown as NotificationRow[];
}

export function countUnread(userId: string): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n;
}

export function markRead(userId: string, ids: readonly string[] | 'all', at: string): number {
  if (ids === 'all') {
    return Number(db().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, userId).changes);
  }
  const statement = db().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL');
  let changed = 0;
  for (const id of ids) changed += Number(statement.run(at, userId, id).changes);
  return changed;
}

export function readPrefs(userId: string): Map<string, boolean> {
  const rows = db().prepare('SELECT kind, enabled FROM notification_prefs WHERE user_id = ?').all(userId) as unknown as { kind: string; enabled: number }[];
  return new Map(rows.map((row) => [row.kind, row.enabled === 1]));
}

export function writePref(userId: string, kind: string, enabled: boolean): void {
  db()
    .prepare(
      `INSERT INTO notification_prefs (user_id, kind, enabled) VALUES (?, ?, ?)
       ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled`,
    )
    .run(userId, kind, enabled ? 1 : 0);
}

/** Notifications older than this are removed by the daily sweep (ems/notifications.ts). */
export function deleteNotificationsBefore(before: string): number {
  return Number(db().prepare('DELETE FROM notifications WHERE created_at < ?').run(before).changes);
}
