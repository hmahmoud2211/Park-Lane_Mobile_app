import { randomInt } from 'node:crypto';

import type { MyUnit, UnitInvite, UnitRole } from '../../../shared/contracts/units.ts';
import { ApiError } from '../errors.ts';
import * as invites from '../repositories/unitInvites.ts';
import * as units from '../repositories/units.ts';
import type { User } from './auth.ts';
import { sha256 } from './secrets.ts';

/**
 * A resident's apartment and who shares it. Owners invite family with a code; whoever enters it, signed in to
 * their own EMS account, joins the unit and so gets both the unit's brand-account devices (Home Assistant) and its
 * CUBE gateway (gateway passes go only to members). Owners can remove members: Home Assistant access ends at once
 * (every request checks membership) and the gateway drops their phones at its next member check.
 */

export const INVITE_TTL_MS = 24 * 3600_000;
const MAX_OPEN_INVITES = 10;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

function newCode(): string {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** What people type: any case, spaces or dashes. */
export function normalizeCode(input: unknown): string {
  const clean = (typeof input === 'string' ? input : '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

const hashOf = (code: string) => sha256(`unit-invite:${code}`);

export function myUnit(user: User): MyUnit {
  const unit = units.findUnitOfUser(user.id);
  const role = units.memberRole(user.id);
  if (!unit || !role) {
    throw new ApiError('no_home', 'Your account is not linked to an apartment yet. Join with an invite code, or ask building management.');
  }
  return {
    unit: { id: unit.id, name: unit.name, building: unit.building },
    role,
    members: units.listMembers(unit.id).map((member) => ({
      userId: member.userId,
      name: member.name,
      email: role === 'owner' ? member.email : null,
      role: member.role,
      you: member.userId === user.id,
      since: member.since,
    })),
  };
}

function ownerUnit(user: User): string {
  const unit = units.findUnitOfUser(user.id);
  if (!unit) {
    throw new ApiError('no_home', 'Your account is not linked to an apartment yet.');
  }
  if (units.memberRole(user.id) !== 'owner') {
    throw new ApiError('forbidden', 'Only an owner of the apartment can do that.');
  }
  return unit.id;
}

export function createInvite(user: User, roleInput: unknown, now = Date.now()): UnitInvite {
  const unitId = ownerUnit(user);
  const role: UnitRole = roleInput === 'owner' ? 'owner' : 'member';
  if (invites.countOpenInvites(unitId, now) >= MAX_OPEN_INVITES) {
    throw new ApiError('rate_limited', 'This apartment has many open invites. Wait until some are used or expire.');
  }
  const code = newCode();
  const expiresAt = now + INVITE_TTL_MS;
  invites.insertInvite(hashOf(code), unitId, role, user.id, now, expiresAt);
  return { code, role, expiresAt };
}

export function joinWithCode(user: User, codeInput: unknown, now = Date.now()): MyUnit {
  const code = normalizeCode(codeInput);
  const invalid = new ApiError('invalid', 'That invite code is wrong, used or expired. Ask the owner for a new one.');
  if (code.length !== 9) {
    throw invalid;
  }
  const current = units.findUnitOfUser(user.id);
  const open = invites.findOpenInvite(hashOf(code), now);
  if (!open) {
    throw invalid;
  }
  if (current && current.id === open.unitId) {
    return myUnit(user); // already in it: the code stays usable for whoever it was meant for
  }
  if (current) {
    throw new ApiError('conflict', 'Your account already belongs to another apartment. Ask building management to move you.');
  }
  const taken = invites.takeInvite(hashOf(code), user.id, now);
  if (!taken) {
    throw invalid;
  }
  units.upsertMember(taken.unitId, user.id, taken.role, new Date(now).toISOString());
  return myUnit(user);
}

export function removeMember(owner: User, userId: string): MyUnit {
  const unitId = ownerUnit(owner);
  if (userId === owner.id) {
    throw new ApiError('bad_request', 'You can\'t remove yourself. Another owner, or building management, can.');
  }
  if (!units.deleteMember(unitId, userId)) {
    throw new ApiError('not_found', 'That person is not a member of your apartment.');
  }
  return myUnit(owner);
}

/** Admin: takes a resident out of a unit. */
export function adminRemoveMember(unitId: string, userId: string): { removed: boolean } {
  return { removed: units.deleteMember(unitId, userId) };
}
