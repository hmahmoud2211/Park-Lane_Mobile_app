import { db } from '../ems/db.ts';

/** The units and unit_members tables: apartments, and the residents who belong to each (one unit per resident). */

export interface Unit {
  id: string;
  name: string;
  building: string | null;
  createdAt: string;
}

export type MemberRole = 'owner' | 'member';

interface UnitRow {
  id: string;
  name: string;
  building: string | null;
  created_at: string;
}

const toUnit = (row: UnitRow): Unit => ({ id: row.id, name: row.name, building: row.building, createdAt: row.created_at });

export function insertUnit(unit: Unit): void {
  db()
    .prepare('INSERT INTO units (id, name, building, created_at) VALUES (?, ?, ?, ?)')
    .run(unit.id, unit.name, unit.building, unit.createdAt);
}

export function findUnit(id: string): Unit | null {
  const row = db().prepare('SELECT id, name, building, created_at FROM units WHERE id = ?').get(id) as UnitRow | undefined;
  return row ? toUnit(row) : null;
}

export function listUnits(): Unit[] {
  return (db().prepare('SELECT id, name, building, created_at FROM units ORDER BY name').all() as unknown as UnitRow[]).map(toUnit);
}

export function deleteUnit(id: string): void {
  db().prepare('DELETE FROM units WHERE id = ?').run(id);
}

/** Puts the user in the unit, moving them out of any other. */
export function upsertMember(unitId: string, userId: string, role: MemberRole, createdAt: string): void {
  db()
    .prepare(
      `INSERT INTO unit_members (unit_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET unit_id = excluded.unit_id, role = excluded.role`,
    )
    .run(unitId, userId, role, createdAt);
}

export function findUnitOfUser(userId: string): Unit | null {
  const row = db()
    .prepare(
      `SELECT units.id, units.name, units.building, units.created_at
       FROM unit_members JOIN units ON units.id = unit_members.unit_id
       WHERE unit_members.user_id = ?`,
    )
    .get(userId) as UnitRow | undefined;
  return row ? toUnit(row) : null;
}

/** The residents of the unit a hub serves. */
export function memberIdsOfHub(hubId: string): string[] {
  const rows = db()
    .prepare('SELECT unit_members.user_id FROM hubs JOIN unit_members ON unit_members.unit_id = hubs.unit_id WHERE hubs.id = ?')
    .all(hubId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

/** The member's role in their unit, or null. */
export function memberRole(userId: string): MemberRole | null {
  const row = db().prepare('SELECT role FROM unit_members WHERE user_id = ?').get(userId) as { role: string } | undefined;
  return row ? (row.role === 'member' ? 'member' : 'owner') : null;
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  since: string;
}

export function listMembers(unitId: string): MemberRow[] {
  const rows = db()
    .prepare(
      `SELECT users.id, users.name, users.email, unit_members.role, unit_members.created_at
       FROM unit_members JOIN users ON users.id = unit_members.user_id
       WHERE unit_members.unit_id = ? ORDER BY unit_members.created_at, users.name`,
    )
    .all(unitId) as unknown as { id: string; name: string; email: string; role: string; created_at: string }[];
  return rows.map((row) => ({ userId: row.id, name: row.name, email: row.email, role: row.role === 'member' ? 'member' : 'owner', since: row.created_at }));
}

export function deleteMember(unitId: string, userId: string): boolean {
  return Number(db().prepare('DELETE FROM unit_members WHERE unit_id = ? AND user_id = ?').run(unitId, userId).changes) > 0;
}
