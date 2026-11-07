import { db, transaction } from '../ems/db.ts';
import type { MemberRole } from './units.ts';

/** The unit_invites table: codes an owner makes for another account to join their unit (stored hashed). */

export function insertInvite(codeHash: string, unitId: string, role: MemberRole, createdBy: string, createdAt: number, expiresAt: number): void {
  db()
    .prepare('INSERT INTO unit_invites (code_hash, unit_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(codeHash, unitId, role, createdBy, createdAt, expiresAt);
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

/** Whether an invite is still open (to tell a resident already in that unit apart without using it up). */
export function findOpenInvite(codeHash: string, now: number): { unitId: string } | null {
  const row = db()
    .prepare('SELECT unit_id FROM unit_invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .get(codeHash, now) as { unit_id: string } | undefined;
  return row ? { unitId: row.unit_id } : null;
}
