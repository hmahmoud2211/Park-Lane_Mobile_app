import { db, transaction } from '../ems/db.ts';
import type { MemberRole } from './units.ts';

/**
 * The unit_invites table: codes an owner makes for another account to join their unit (stored hashed). An invite's
 * id in lists and addresses is its row number, which has nothing to do with the code.
 */

/** Stores an invite; answers its id. */
export function insertInvite(codeHash: string, unitId: string, role: MemberRole, createdBy: string, createdAt: number, expiresAt: number): string {
  const result = db()
    .prepare('INSERT INTO unit_invites (code_hash, unit_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(codeHash, unitId, role, createdBy, createdAt, expiresAt);
  return String(result.lastInsertRowid);
}

export function countOpenInvites(unitId: string, now: number): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM unit_invites WHERE unit_id = ? AND used_at IS NULL AND expires_at > ?').get(unitId, now) as { n: number };
  return Number(row.n);
}

/** The invite's unit and role, marking it used, or null if it is unknown, used or expired. */
export function takeInvite(codeHash: string, userId: string, now: number): { unitId: string; role: MemberRole } | null {
  return transaction(() => {
    const row = db()
      .prepare('SELECT unit_id, role FROM unit_invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(codeHash, now) as { unit_id: string; role: string } | undefined;
    if (!row) {
      return null;
    }
    db().prepare('UPDATE unit_invites SET used_at = ?, used_by = ? WHERE code_hash = ?').run(now, userId, codeHash);
    return { unitId: row.unit_id, role: row.role === 'owner' ? 'owner' : 'member' };
  });
}

export interface InviteRow {
  /** The row number: never derived from the code, so showing or logging it gives nothing away. */
  id: string;
  /** For taking the invite; never leaves the backend. */
  codeHash: string;
  unitId: string;
  role: MemberRole;
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
  unit_id: string;
  role: string;
  created_by: string;
  created_by_name: string | null;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
}

const INVITE_COLUMNS = `unit_invites.rowid AS id, unit_invites.code_hash, unit_invites.unit_id, unit_invites.role, unit_invites.created_by, users.name AS created_by_name,
  unit_invites.created_at, unit_invites.expires_at, unit_invites.used_by, unit_invites.used_at`;

const present = (row: RawInvite): InviteRow => ({
  id: String(row.id),
  codeHash: row.code_hash,
  unitId: row.unit_id,
  role: row.role === 'owner' ? 'owner' : 'member',
  createdBy: row.created_by,
  createdByName: row.created_by_name ?? '',
  createdAt: Number(row.created_at),
  expiresAt: Number(row.expires_at),
  usedBy: row.used_by,
  usedAt: row.used_at === null ? null : Number(row.used_at),
});

/** The invite with this hash, used, expired or open, or null if there never was one. */
export function findInvite(codeHash: string): InviteRow | null {
  const row = db()
    .prepare(`SELECT ${INVITE_COLUMNS} FROM unit_invites LEFT JOIN users ON users.id = unit_invites.created_by WHERE code_hash = ?`)
    .get(codeHash) as RawInvite | undefined;
  return row ? present(row) : null;
}

/** The unit's invites nobody has used yet and that still work, newest first. */
export function listOpenInvites(unitId: string, now: number): InviteRow[] {
  const rows = db()
    .prepare(
      `SELECT ${INVITE_COLUMNS} FROM unit_invites LEFT JOIN users ON users.id = unit_invites.created_by
       WHERE unit_invites.unit_id = ? AND unit_invites.used_at IS NULL AND unit_invites.expires_at > ?
       ORDER BY unit_invites.created_at DESC, unit_invites.rowid DESC`,
    )
    .all(unitId, now) as unknown as RawInvite[];
  return rows.map(present);
}

/** Cancels one of the unit's unused invites by its id; false if there is no such open invite. */
export function deleteOpenInvite(unitId: string, id: string): boolean {
  const result = db()
    .prepare('DELETE FROM unit_invites WHERE unit_id = ? AND rowid = ? AND used_at IS NULL')
    .run(unitId, /^\d{1,15}$/.test(id) ? Number(id) : -1);
  return Number(result.changes) > 0;
}
