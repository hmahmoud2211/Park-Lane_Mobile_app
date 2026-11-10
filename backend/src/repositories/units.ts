import { db } from '../ems/db.ts';

/** The units and unit_members tables: apartments, and the residents who belong to each (one unit per resident). */

export interface Unit {
  id: string;
  name: string;
  building: string | null;
  createdAt: string;
  /** The compound it belongs to (sites table). New units go to DEFAULT_SITE_ID unless one is given. */
  siteId?: string;
}

/** The site every unit belonged to before sites existed (migration 14). */
export const DEFAULT_SITE_ID = 'park-lane';

/** What building management records about a unit, shown on My Unit. Every field may be unset. */
export interface UnitDetails {
  tower: string | null;
  floor: number | null;
  number: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  parkingBay: string | null;
  handoverStatus: string | null;
}

export type MemberRole = 'owner' | 'member';

interface UnitRow {
  id: string;
  name: string;
  building: string | null;
  created_at: string;
  site_id: string | null;
}

const UNIT_COLUMNS = 'units.id, units.name, units.building, units.created_at, units.site_id';

const toUnit = (row: UnitRow): Unit => ({
  id: row.id,
  name: row.name,
  building: row.building,
  createdAt: row.created_at,
  siteId: row.site_id ?? DEFAULT_SITE_ID,
});

export function insertUnit(unit: Unit): void {
  db()
    .prepare('INSERT INTO units (id, name, building, created_at, site_id) VALUES (?, ?, ?, ?, ?)')
    .run(unit.id, unit.name, unit.building, unit.createdAt, unit.siteId ?? DEFAULT_SITE_ID);
}

export function findUnit(id: string): Unit | null {
  const row = db().prepare(`SELECT ${UNIT_COLUMNS} FROM units WHERE id = ?`).get(id) as UnitRow | undefined;
  return row ? toUnit(row) : null;
}

export function listUnits(): Unit[] {
  return (db().prepare(`SELECT ${UNIT_COLUMNS} FROM units ORDER BY name`).all() as unknown as UnitRow[]).map(toUnit);
}

export function findUnitDetails(id: string): UnitDetails | null {
  const row = db()
    .prepare('SELECT tower, floor, number, unit_type, bedrooms, bathrooms, area_m2, parking_bay, handover_status FROM units WHERE id = ?')
    .get(id) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    tower: row.tower as string | null,
    floor: row.floor as number | null,
    number: row.number as string | null,
    unitType: row.unit_type as string | null,
    bedrooms: row.bedrooms as number | null,
    bathrooms: row.bathrooms as number | null,
    areaM2: row.area_m2 as number | null,
    parkingBay: row.parking_bay as string | null,
    handoverStatus: row.handover_status as string | null,
  };
}

export function updateUnitDetails(id: string, details: UnitDetails): void {
  db()
    .prepare(
      `UPDATE units SET tower = ?, floor = ?, number = ?, unit_type = ?, bedrooms = ?, bathrooms = ?, area_m2 = ?,
       parking_bay = ?, handover_status = ? WHERE id = ?`,
    )
    .run(
      details.tower, details.floor, details.number, details.unitType, details.bedrooms, details.bathrooms,
      details.areaM2, details.parkingBay, details.handoverStatus, id,
    );
}

/** Everyone who lives in the unit. */
export function memberIdsOfUnit(unitId: string): string[] {
  const rows = db().prepare('SELECT user_id FROM unit_members WHERE unit_id = ?').all(unitId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

/** Everyone who lives anywhere on the site. */
export function memberIdsOfSite(siteId: string): string[] {
  const rows = db()
    .prepare('SELECT unit_members.user_id FROM unit_members JOIN units ON units.id = unit_members.unit_id WHERE units.site_id = ?')
    .all(siteId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
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
      `SELECT ${UNIT_COLUMNS}
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
