import { randomInt } from 'node:crypto';

import type { MyUnit, OpenUnitInvite, UnitInvite, UnitInvitePreview, UnitRole } from '../../../shared/contracts/units.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import * as invites from '../repositories/unitInvites.ts';
import * as units from '../repositories/units.ts';
import type { User } from './auth.ts';
import { publishToUnit, publishToUsers } from './broadcast.ts';
import { notify } from './notifications.ts';
import { sha256, sign } from './secrets.ts';

/**
 * A resident's apartment and who shares it. Owners invite family with a code; whoever enters it, signed in to
 * their own EMS account, joins the unit and so gets both the unit's brand-account devices (Home Assistant) and its
 * CUBE gateway (gateway passes go only to members). Owners can remove members: Home Assistant access ends at once
 * (every request checks membership) and the gateway drops their phones at its next member check.
 *
 * An invite works once, for 24 hours, and only while the owner who made it is still an owner of that apartment.
 * The app can check a code first (checkInvite) to ask "Join Tower A · 1203?", and owners see and cancel the invites
 * nobody has used yet. A wrong code, a used one and an expired one each get their own answer, so the invited person
 * knows whether to check their typing or ask for a new code; telling used from expired reveals nothing to someone
 * guessing, who first has to hit a real code.
 */

export const INVITE_TTL_MS = 24 * 3600_000;
const MAX_OPEN_INVITES = 10;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

function newCode(): string {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** What people type or paste: any case, spaces or dashes, or the whole invite message or link around the code. */
export function normalizeCode(input: unknown): string {
  const text = typeof input === 'string' ? input : '';
  // A pasted link or message: the code is the part after /join/, or a code as the backend writes it (capitals from
  // the code alphabet), so words like "Park-Lane" in the message are not mistaken for one.
  const linked =
    /\/join[/#]([0-9A-Za-z]{4}-?[0-9A-Za-z]{4})(?![0-9A-Za-z])/.exec(text) ?? /(?<![0-9A-Za-z])([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})(?![0-9A-Za-z])/.exec(text);
  const clean = (linked ? linked[1] : text).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * How a code is stored: keyed from the sealing key, so a copy of the database can't be searched for the codes (there
 * are only 32^8 of them). Invites made before keying are still found by their plain hash until they expire.
 */
const hashOf = (code: string) => sign(`unit-invite:${code}`);
const legacyHashOf = (code: string) => sha256(`unit-invite:${code}`);
const findByCode = (code: string) => invites.findInvite(hashOf(code)) ?? invites.findInvite(legacyHashOf(code));

/**
 * The public page that opens the app on this code (public/serve.ts), when this backend knows its own address. The
 * code goes after `#`, which browsers never send: it stays out of Cloudflare's, the proxy's and this server's logs.
 */
export const inviteLink = (code: string): string | null => (config.publicUrl ? `${config.publicUrl}/join#${code}` : null);

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

/** Whether whoever made the invite is still an owner of its apartment: a removed owner's codes stop working. */
function madeByCurrentOwner(invite: invites.InviteRow): boolean {
  return units.findUnitOfUser(invite.createdBy)?.id === invite.unitId && units.memberRole(invite.createdBy) === 'owner';
}

const wrongCode = () => new ApiError('invalid', 'We couldn\'t find that code. Check it and try again, or ask for a new invite.');

/**
 * The invite a code names, if the signed-in user may still use it, or the reason not as an ApiError. A code for
 * the apartment they are already in answers `alreadyMember`, used or not, so tapping an old link twice is harmless.
 */
function usableInvite(user: User, codeInput: unknown, now: number): { invite: invites.InviteRow; code: string; alreadyMember: boolean } {
  const code = normalizeCode(codeInput);
  if (code.length !== 9) {
    throw wrongCode();
  }
  const invite = findByCode(code);
  if (!invite) {
    throw wrongCode();
  }
  const current = units.findUnitOfUser(user.id);
  if (current?.id === invite.unitId) {
    return { invite, code, alreadyMember: true };
  }
  if (invite.usedAt !== null) {
    throw new ApiError('invite_used', 'Someone already used this invite. Ask for a new one: each code works once.');
  }
  if (invite.expiresAt <= now) {
    throw new ApiError('invite_expired', 'This invite has expired. Codes work for 24 hours. Ask for a new one.');
  }
  if (!madeByCurrentOwner(invite)) {
    throw new ApiError('invite_expired', 'This invite no longer works. Ask an owner of the apartment for a new one.');
  }
  if (current) {
    throw new ApiError('conflict', `Your account is already in ${current.name}. Ask building management to move you.`);
  }
  return { invite, code, alreadyMember: false };
}

export function createInvite(user: User, roleInput: unknown, now = Date.now()): UnitInvite {
  const unitId = ownerUnit(user);
  const role: UnitRole = roleInput === 'owner' ? 'owner' : 'member';
  if (invites.countOpenInvites(unitId, now) >= MAX_OPEN_INVITES) {
    throw new ApiError('rate_limited', 'This apartment has 10 invites waiting. Cancel one you don\'t need, or wait until they are used.');
  }
  const code = newCode();
  const expiresAt = now + INVITE_TTL_MS;
  const id = invites.insertInvite(hashOf(code), unitId, role, user.id, now, expiresAt);
  publishToUnit(unitId, { type: 'unit.updated' });
  return { id, code, link: inviteLink(code), role, expiresAt };
}

/** The apartment's invites still waiting to be used (owners). */
export function listInvites(user: User, now = Date.now()): OpenUnitInvite[] {
  const unitId = ownerUnit(user);
  return invites
    .listOpenInvites(unitId, now)
    .filter(madeByCurrentOwner)
    .map((invite) => ({ id: invite.id, role: invite.role, invitedBy: invite.createdByName, createdAt: invite.createdAt, expiresAt: invite.expiresAt }));
}

/** Cancels an invite nobody has used yet (owners); its code stops working at once. */
export function cancelInvite(user: User, id: string, now = Date.now()): OpenUnitInvite[] {
  const unitId = ownerUnit(user);
  if (!invites.deleteOpenInvite(unitId, id)) {
    throw new ApiError('not_found', 'That invite was already used or cancelled.');
  }
  publishToUnit(unitId, { type: 'unit.updated' });
  return listInvites(user, now);
}

/** What joining with this code would do, without joining: the apartment's name, who invited, and as what. */
export function checkInvite(user: User, codeInput: unknown, now = Date.now()): UnitInvitePreview {
  const { invite, alreadyMember } = usableInvite(user, codeInput, now);
  const unit = units.findUnit(invite.unitId);
  if (!unit) {
    throw wrongCode();
  }
  return {
    unit: { name: unit.name, building: unit.building },
    invitedBy: invite.createdByName,
    role: invite.role,
    expiresAt: invite.expiresAt,
    alreadyMember,
  };
}

export function joinWithCode(user: User, codeInput: unknown, now = Date.now()): MyUnit {
  const { invite, alreadyMember } = usableInvite(user, codeInput, now);
  if (alreadyMember) {
    return myUnit(user); // already in it: an unused code stays usable for whoever it was meant for
  }
  const taken = invites.takeInvite(invite.codeHash, user.id, now);
  if (!taken) {
    // Someone else used it in the same moment.
    throw new ApiError('invite_used', 'Someone already used this invite. Ask for a new one: each code works once.');
  }
  units.upsertMember(taken.unitId, user.id, taken.role, new Date(now).toISOString());
  const unit = units.findUnit(taken.unitId);
  const owners = units
    .listMembers(taken.unitId)
    .filter((member) => member.role === 'owner' && member.userId !== user.id)
    .map((member) => member.userId);
  notify(owners, {
    kind: 'account',
    title: `${user.name || 'Someone'} joined ${unit?.name ?? 'your apartment'}`,
    body: invite.role === 'owner' ? 'They joined as an owner, with your invite.' : 'They joined with your invite.',
    ref: { type: 'unit', id: taken.unitId },
  });
  publishToUnit(taken.unitId, { type: 'unit.updated' });
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
  // The removed person too, so their app drops the apartment now rather than at its next failed call.
  publishToUsers([...units.memberIdsOfUnit(unitId), userId], { type: 'unit.updated' });
  return myUnit(owner);
}

/** Admin: takes a resident out of a unit. */
export function adminRemoveMember(unitId: string, userId: string): { removed: boolean } {
  const removed = units.deleteMember(unitId, userId);
  if (removed) publishToUsers([...units.memberIdsOfUnit(unitId), userId], { type: 'unit.updated' });
  return { removed };
}
