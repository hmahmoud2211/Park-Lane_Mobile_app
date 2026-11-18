import { db } from '../ems/db.ts';

/** The circles and circle_members tables: Family Circles and who is in each, with each member's own sharing choice. */

export type CircleRole = 'owner' | 'member';

export interface CircleRow {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
}

export interface CircleMemberRow {
  circleId: string;
  userId: string;
  name: string;
  role: CircleRole;
  sharing: boolean;
  joinedAt: string;
}

interface RawMember {
  circle_id: string;
  user_id: string;
  name: string | null;
  role: string;
  sharing: number;
  joined_at: string;
}

const toMember = (row: RawMember): CircleMemberRow => ({
  circleId: row.circle_id,
  userId: row.user_id,
  name: row.name ?? '',
  role: row.role === 'owner' ? 'owner' : 'member',
  sharing: Number(row.sharing) === 1,
  joinedAt: row.joined_at,
});

const MEMBER_COLUMNS = 'm.circle_id, m.user_id, users.name, m.role, m.sharing, m.joined_at';

export function insertCircle(circle: CircleRow): void {
  db().prepare('INSERT INTO circles (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(circle.id, circle.name, circle.createdBy, circle.createdAt);
}

export function findCircle(id: string): CircleRow | null {
  const row = db().prepare('SELECT id, name, created_by, created_at FROM circles WHERE id = ?').get(id) as
    | { id: string; name: string; created_by: string | null; created_at: string }
    | undefined;
  return row ? { id: row.id, name: row.name, createdBy: row.created_by, createdAt: row.created_at } : null;
}

/** The Circles the person is in, oldest first. */
export function listCirclesOfUser(userId: string): CircleRow[] {
  const rows = db()
    .prepare(
      `SELECT c.id, c.name, c.created_by, c.created_at FROM circles c JOIN circle_members m ON m.circle_id = c.id
       WHERE m.user_id = ? ORDER BY m.joined_at, c.created_at, c.id`,
    )
    .all(userId) as unknown as { id: string; name: string; created_by: string | null; created_at: string }[];
  return rows.map((row) => ({ id: row.id, name: row.name, createdBy: row.created_by, createdAt: row.created_at }));
}

export function renameCircle(id: string, name: string): void {
  db().prepare('UPDATE circles SET name = ? WHERE id = ?').run(name, id);
}

/** Removes the Circle, its members and its invites (ON DELETE CASCADE). */
export function deleteCircle(id: string): void {
  db().prepare('DELETE FROM circles WHERE id = ?').run(id);
}

export function countCirclesOfUser(userId: string): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').get(userId) as { n: number };
  return Number(row.n);
}

export function countMembers(circleId: string): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM circle_members WHERE circle_id = ?').get(circleId) as { n: number };
  return Number(row.n);
}

/** Members in the order they joined (owners first among equals). */
export function listMembers(circleId: string): CircleMemberRow[] {
  const rows = db()
    .prepare(
      `SELECT ${MEMBER_COLUMNS} FROM circle_members m LEFT JOIN users ON users.id = m.user_id
       WHERE m.circle_id = ? ORDER BY m.joined_at, m.role = 'owner' DESC, m.user_id`,
    )
    .all(circleId) as unknown as RawMember[];
  return rows.map(toMember);
}

export function findMember(circleId: string, userId: string): CircleMemberRow | null {
  const row = db()
    .prepare(`SELECT ${MEMBER_COLUMNS} FROM circle_members m LEFT JOIN users ON users.id = m.user_id WHERE m.circle_id = ? AND m.user_id = ?`)
    .get(circleId, userId) as RawMember | undefined;
  return row ? toMember(row) : null;
}

export function insertMember(circleId: string, userId: string, role: CircleRole, joinedAt: string): void {
  db()
    .prepare('INSERT INTO circle_members (circle_id, user_id, role, sharing, joined_at) VALUES (?, ?, ?, 0, ?)')
    .run(circleId, userId, role, joinedAt);
}

export function deleteMember(circleId: string, userId: string): boolean {
  const result = db().prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').run(circleId, userId);
  return Number(result.changes) > 0;
}

export function setMemberRole(circleId: string, userId: string, role: CircleRole): void {
  db().prepare('UPDATE circle_members SET role = ? WHERE circle_id = ? AND user_id = ?').run(role, circleId, userId);
}

export function setSharing(circleId: string, userId: string, sharing: boolean): void {
  db().prepare('UPDATE circle_members SET sharing = ? WHERE circle_id = ? AND user_id = ?').run(sharing ? 1 : 0, circleId, userId);
}

/** Whether the person shares in at least one Circle. */
export function sharesAnywhere(userId: string): boolean {
  return db().prepare('SELECT 1 FROM circle_members WHERE user_id = ? AND sharing = 1 LIMIT 1').get(userId) !== undefined;
}

/** Everyone in a Circle where `userId` shares, besides them: the people who may see their position. */
export function viewerIdsOf(userId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT other.user_id FROM circle_members mine JOIN circle_members other ON other.circle_id = mine.circle_id
       WHERE mine.user_id = ? AND mine.sharing = 1 AND other.user_id != ?`,
    )
    .all(userId, userId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

export function memberIdsOfCircle(circleId: string): string[] {
  const rows = db().prepare('SELECT user_id FROM circle_members WHERE circle_id = ?').all(circleId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

/** Every Circle the person is in, for account deletion: each is left as if they left it themselves. */
export function circleIdsOfUser(userId: string): string[] {
  const rows = db().prepare('SELECT circle_id FROM circle_members WHERE user_id = ?').all(userId) as unknown as { circle_id: string }[];
  return rows.map((row) => row.circle_id);
}
