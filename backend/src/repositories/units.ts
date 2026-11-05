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
