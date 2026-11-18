import { db } from '../ems/db.ts';

/**
 * The circle_invites table: codes an owner makes for another account to join their Family Circle (stored hashed).
 * An invite's id in lists and addresses is its row number, which has nothing to do with the code.
 */

export interface CircleInviteRow {
  id: string;
  /** For taking the invite; never leaves the backend. */
  codeHash: string;
  circleId: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

interface RawInvite {
  id: number;
  code_hash: string;
  circle_id: string;
  created_by: string;
  created_by_name: string | null;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
}

const COLUMNS = `circle_invites.rowid AS id, circle_invites.code_hash, circle_invites.circle_id, circle_invites.created_by,
  users.name AS created_by_name, circle_invites.created_at, circle_invites.expires_at, circle_invites.used_by, circle_invites.used_at`;

const present = (row: RawInvite): CircleInviteRow => ({
  id: String(row.id),
  codeHash: row.code_hash,
  circleId: row.circle_id,
  createdBy: row.created_by,
  createdByName: row.created_by_name ?? '',
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
  usedBy: row.used_by,
  usedAt: row.used_at === null ? null : Number(row.used_at),
});

/** Stores an invite; answers its id. */
export function insertCircleInvite(codeHash: string, circleId: string, createdBy: string, createdAt: number, expiresAt: number): string {
  const result = db()
    .prepare('INSERT INTO circle_invites (code_hash, circle_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(codeHash, circleId, createdBy, createdAt, expiresAt);
  return String(result.lastInsertRowid);
}

export function countOpenCircleInvites(circleId: string, now: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM circle_invites WHERE circle_id = ? AND used_at IS NULL AND expires_at > ?')
    .get(circleId, now) as { n: number };
  return Number(row.n);
}

/** The invite with this hash, used, expired or open, or null if there never was one. */
export function findCircleInvite(codeHash: string): CircleInviteRow | null {
  const row = db()
    .prepare(`SELECT ${COLUMNS} FROM circle_invites LEFT JOIN users ON users.id = circle_invites.created_by WHERE code_hash = ?`)
    .get(codeHash) as RawInvite | undefined;
  return row ? present(row) : null;
}

/** Marks the invite used by `userId`; false if it is no longer open (someone used it in the same moment). */
export function takeCircleInvite(codeHash: string, userId: string, now: number): boolean {
  const result = db()
    .prepare('UPDATE circle_invites SET used_at = ?, used_by = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .run(now, userId, codeHash, now);
  return Number(result.changes) > 0;
}

/** The Circle's invites nobody has used yet and that still work, newest first. */
export function listOpenCircleInvites(circleId: string, now: number): CircleInviteRow[] {
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM circle_invites LEFT JOIN users ON users.id = circle_invites.created_by
       WHERE circle_invites.circle_id = ? AND circle_invites.used_at IS NULL AND circle_invites.expires_at > ?
       ORDER BY circle_invites.created_at DESC, circle_invites.rowid DESC`,
    )
    .all(circleId, now) as unknown as RawInvite[];
  return rows.map(present);
}

/** Cancels one of the Circle's unused invites by its id; false if there is no such open invite. */
export function deleteOpenCircleInvite(circleId: string, id: string): boolean {
  const result = db()
    .prepare('DELETE FROM circle_invites WHERE circle_id = ? AND rowid = ? AND used_at IS NULL')
    .run(circleId, /^\d{1,15}$/.test(id) ? Number(id) : -1);
  return Number(result.changes) > 0;
}