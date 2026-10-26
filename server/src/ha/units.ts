import { randomUUID } from 'node:crypto';

import { findUserByEmail, normalizeEmail } from '../ems/auth.ts';
import { db } from '../ems/db.ts';
import { ApiError } from '../errors.ts';

/** Apartments, the residents who belong to each, and which hub serves them. */

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

export function createUnit(nameInput: unknown, buildingInput: unknown): Unit {
  const name = typeof nameInput === 'string' ? nameInput.trim().slice(0, 64) : '';
  if (!name) {
    throw new ApiError('bad_request', 'name is required, e.g. "Tower A · 1203".');
  }
  const building = typeof buildingInput === 'string' && buildingInput.trim() ? buildingInput.trim().slice(0, 64) : null;
  const unit: Unit = { id: randomUUID(), name, building, createdAt: new Date().toISOString() };
  db()
    .prepare('INSERT INTO units (id, name, building, created_at) VALUES (?, ?, ?, ?)')
    .run(unit.id, unit.name, unit.building, unit.createdAt);
  return unit;
}

export function getUnit(id: string): Unit {
  const row = db().prepare('SELECT id, name, building, created_at FROM units WHERE id = ?').get(id) as UnitRow | undefined;
  if (!row) {
    throw new ApiError('not_found', 'No such unit.');
  }
  return toUnit(row);
}

export function listUnits(): Unit[] {
  return (db().prepare('SELECT id, name, building, created_at FROM units ORDER BY name').all() as unknown as UnitRow[]).map(toUnit);
}

export function deleteUnit(id: string): void {
  db().prepare('DELETE FROM units WHERE id = ?').run(id);
}

/** Puts a resident (an existing EMS account) in a unit, moving them from any other. */
export function addMember(unitId: string, emailInput: unknown, roleInput: unknown) {
  getUnit(unitId);
  const user = findUserByEmail(normalizeEmail(emailInput));
  if (!user) {
    throw new ApiError('not_found', 'No EMS account with that email. The resident signs up in the app first.');
  }
  const role: MemberRole = roleInput === 'member' ? 'member' : 'owner';
  db()
    .prepare(
      `INSERT INTO unit_members (unit_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET unit_id = excluded.unit_id, role = excluded.role`,
    )
    .run(unitId, user.id, role, new Date().toISOString());
  return { unitId, user, role };
}

/** The unit a resident belongs to, or 404 no_home. */
export function unitForUser(userId: string): Unit {
  const row = db()
    .prepare(
      `SELECT units.id, units.name, units.building, units.created_at
       FROM unit_members JOIN units ON units.id = unit_members.unit_id
       WHERE unit_members.user_id = ?`,
    )
    .get(userId) as UnitRow | undefined;
  if (!row) {
    throw new ApiError('no_home', 'Your account is not linked to a unit yet. Ask building management to add you.');
  }
  return toUnit(row);
}

/** Everyone who should hear about changes on a hub. */
export function membersOfHub(hubId: string): string[] {
  const rows = db()
    .prepare('SELECT unit_members.user_id FROM hubs JOIN unit_members ON unit_members.unit_id = hubs.unit_id WHERE hubs.id = ?')
    .all(hubId) as unknown as { user_id: string }[];
  return rows.map((row) => row.user_id);
}
