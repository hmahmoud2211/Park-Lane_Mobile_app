import { db } from '../ems/db.ts';

/**
 * The member_locations table: each person's latest position (sealed by the caller) and phone battery, kept only while
 * they share in a Family Circle (database triggers delete it when they share nowhere).
 */

export interface MemberLocationRow {
  userId: string;
  /** Sealed JSON { lat, lng, accuracyM }. */
  point: string;
  /** When the phone took the point, ms. */
  at: number;
  batteryLevel: number | null;
  charging: boolean | null;
  updatedAt: number;
}

interface RawLocation {
  user_id: string;
  point: string;
  at: number;
  battery_level: number | null;
  charging: number | null;
  updated_at: number;
}

const toRow = (row: RawLocation): MemberLocationRow => ({
  userId: row.user_id,
  point: row.point,
  at: Number(row.at),
  batteryLevel: row.battery_level === null ? null : Number(row.battery_level),
  charging: row.charging === null ? null : Number(row.charging) === 1,
  updatedAt: Number(row.updated_at),
});

export function findMemberLocation(userId: string): MemberLocationRow | null {
  const row = db().prepare('SELECT user_id, point, at, battery_level, charging, updated_at FROM member_locations WHERE user_id = ?').get(userId) as
    | RawLocation
    | undefined;
  return row ? toRow(row) : null;
}

/** The saved rows of these people, by user id. */
export function findMemberLocations(userIds: readonly string[]): Map<string, MemberLocationRow> {
  if (userIds.length === 0) {
    return new Map();
  }
  const placeholders = userIds.map(() => '?').join(', ');
  const rows = db()
    .prepare(`SELECT user_id, point, at, battery_level, charging, updated_at FROM member_locations WHERE user_id IN (${placeholders})`)
    .all(...userIds) as unknown as RawLocation[];
  return new Map(rows.map((row) => [row.user_id, toRow(row)]));
}

/** Saves the person's latest position and battery, replacing the one before. */
export function upsertMemberLocation(row: MemberLocationRow): void {
  db()
    .prepare(
      `INSERT INTO member_locations (user_id, point, at, battery_level, charging, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET point = excluded.point, at = excluded.at, battery_level = excluded.battery_level,
         charging = excluded.charging, updated_at = excluded.updated_at`,
    )
    .run(row.userId, row.point, row.at, row.batteryLevel, row.charging === null ? null : row.charging ? 1 : 0, row.updatedAt);
}

/** Only the battery, when every point of a report was older than the saved one. */
export function updateMemberBattery(userId: string, batteryLevel: number | null, charging: boolean | null, updatedAt: number): void {
  db()
    .prepare('UPDATE member_locations SET battery_level = ?, charging = ?, updated_at = ? WHERE user_id = ?')
    .run(batteryLevel, charging === null ? null : charging ? 1 : 0, updatedAt, userId);
}

export function deleteMemberLocation(userId: string): void {
  db().prepare('DELETE FROM member_locations WHERE user_id = ?').run(userId);
}
