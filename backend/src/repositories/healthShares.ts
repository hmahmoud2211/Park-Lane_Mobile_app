import { db } from '../ems/db.ts';
import type { ProfileRow } from './healthProfiles.ts';

/**
 * The health_shares table: Health Passport profiles a keeper shares with
 * another resident of their apartment. The rules (who may share, what each
 * access allows) are in health/sharing.ts and health/passport.ts.
 */

export type ShareAccess = 'view' | 'edit';

export interface ShareRow {
  user_id: string;
  name: string;
  email: string;
  access: ShareAccess;
  created_at: string;
}

const accessOf = (value: string): ShareAccess => (value === 'edit' ? 'edit' : 'view');

export function findShareAccess(profileId: string, userId: string): ShareAccess | null {
  const row = db().prepare('SELECT access FROM health_shares WHERE profile_id = ? AND user_id = ?').get(profileId, userId) as
    | { access: string }
    | undefined;
  return row ? accessOf(row.access) : null;
}

/** Who a profile is shared with, in the order it was shared. */
export function listSharesOfProfile(profileId: string): ShareRow[] {
  const rows = db()
    .prepare(
      `SELECT s.user_id, u.name, u.email, s.access, s.created_at
       FROM health_shares s JOIN users u ON u.id = s.user_id
       WHERE s.profile_id = ? ORDER BY s.created_at, u.name`,
    )
    .all(profileId) as unknown as ShareRow[];
  return rows.map((row) => ({ ...row, access: accessOf(row.access) }));
}

export interface SharedProfileRow extends ProfileRow {
  access: ShareAccess;
  keeper_name: string;
}

/**
 * Profiles shared with the user that still count: the keeper lives in the
 * same apartment and has Health Passport switched on. Grouped by keeper,
 * each keeper's own profile first.
 */
export function listProfilesSharedWith(userId: string): SharedProfileRow[] {
  const rows = db()
    .prepare(
      `SELECT p.id, p.owner_id, p.relation, p.name, p.sex, p.date_of_birth, p.blood_type, p.record_updated_at,
              s.access, u.name AS keeper_name
       FROM health_shares s
       JOIN health_profiles p ON p.id = s.profile_id
       JOIN users u ON u.id = p.owner_id
       JOIN unit_members keeper ON keeper.user_id = p.owner_id
       JOIN unit_members reader ON reader.user_id = s.user_id AND reader.unit_id = keeper.unit_id
       JOIN health_consents c ON c.user_id = p.owner_id AND c.given = 1
       WHERE s.user_id = ?
       ORDER BY u.name, p.owner_id, CASE p.relation WHEN 'self' THEN 0 ELSE 1 END, p.created_at`,
    )
    .all(userId) as unknown as SharedProfileRow[];
  return rows.map((row) => ({ ...row, access: accessOf(row.access) }));
}

/** How many people each profile the keeper shares is shared with; profiles shared with nobody are left out. */
export function countSharesOfKeeper(ownerId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT s.profile_id, COUNT(*) AS count FROM health_shares s JOIN health_profiles p ON p.id = s.profile_id
       WHERE p.owner_id = ? GROUP BY s.profile_id`,
    )
    .all(ownerId) as unknown as { profile_id: string; count: number }[];
  return new Map(rows.map((row) => [row.profile_id, Number(row.count)]));
}

export function upsertShare(profileId: string, userId: string, access: ShareAccess, at: string): void {
  db()
    .prepare(
      `INSERT INTO health_shares (profile_id, user_id, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, user_id) DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
    )
    .run(profileId, userId, access, at, at);
}

export function deleteShare(profileId: string, userId: string): boolean {
  return Number(db().prepare('DELETE FROM health_shares WHERE profile_id = ? AND user_id = ?').run(profileId, userId).changes) > 0;
}

/** Every share the user gave (on any profile they keep) or got. */
export function deleteSharesOfUser(userId: string): void {
  db()
    .prepare('DELETE FROM health_shares WHERE user_id = ? OR profile_id IN (SELECT id FROM health_profiles WHERE owner_id = ?)')
    .run(userId, userId);
}

/** Whether the two users belong to the same unit. */
export function shareUnit(userId: string, otherId: string): boolean {
  return Boolean(
    db()
      .prepare('SELECT 1 FROM unit_members a JOIN unit_members b ON b.unit_id = a.unit_id WHERE a.user_id = ? AND b.user_id = ?')
      .get(userId, otherId),
  );
}
