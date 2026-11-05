import { randomUUID } from 'node:crypto';

import { findUserByEmail, loginOf } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { trimmedText } from '../lib/text.ts';
import * as units from '../repositories/units.ts';
import type { MemberRole, Unit } from '../repositories/units.ts';

/** Apartments, the residents who belong to each, and which hub serves them. */

export type { MemberRole, Unit };

export function createUnit(nameInput: unknown, buildingInput: unknown): Unit {
  const name = trimmedText(nameInput);
  if (!name) {
    throw new ApiError('bad_request', 'name is required, e.g. "Tower A · 1203".');
  }
  const building = trimmedText(buildingInput) || null;
  const unit: Unit = { id: randomUUID(), name, building, createdAt: new Date().toISOString() };
  units.insertUnit(unit);
  return unit;
}

export function getUnit(id: string): Unit {
  const unit = units.findUnit(id);
  if (!unit) {
    throw new ApiError('not_found', 'No such unit.');
  }
  return unit;
}

export function listUnits(): Unit[] {
  return units.listUnits();
}

export function deleteUnit(id: string): void {
  units.deleteUnit(id);
}

/** Puts a resident (an existing EMS account) in a unit, moving them from any other. */
export function addMember(unitId: string, emailInput: unknown, roleInput: unknown) {
  getUnit(unitId);
  const user = findUserByEmail(loginOf(emailInput));
  if (!user) {
    throw new ApiError('not_found', 'No EMS account with that email. The resident signs up in the app first.');
  }
  const role: MemberRole = roleInput === 'member' ? 'member' : 'owner';
  units.upsertMember(unitId, user.id, role, new Date().toISOString());
  return { unitId, user, role };
}

/** The unit a resident belongs to, or 404 no_home. */
export function unitForUser(userId: string): Unit {
  const unit = units.findUnitOfUser(userId);
  if (!unit) {
    throw new ApiError('no_home', 'Your account is not linked to a unit yet. Ask building management to add you.');
  }
  return unit;
}

/** Everyone who should hear about changes on a hub. */
export function membersOfHub(hubId: string): string[] {
  return units.memberIdsOfHub(hubId);
}
