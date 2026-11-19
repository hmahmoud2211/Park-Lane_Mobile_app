import { randomUUID } from 'node:crypto';

import type { Circle, CircleInvite, CircleInvitePreview, OpenCircleInvite } from '../../../shared/contracts/circles.ts';
import type { User } from '../ems/auth.ts';
import { publishToUsers } from '../ems/broadcast.ts';
import { transaction } from '../ems/db.ts';
import { INVITE_TTL_MS, newCode, normalizeCode } from '../ems/membership.ts';
import { sign } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import { trimmedText } from '../lib/text.ts';
import * as invites from '../repositories/circleInvites.ts';
import * as circles from '../repositories/circles.ts';
import { findMemberLocations } from '../repositories/memberLocations.ts';
import { positionOf } from './location.ts';

/**
 * Family Circles (docs/plans/FAMILY_CIRCLE_PLAN.md): groups of accounts that share their location and battery. A
 * Circle is not tied to an apartment: whoever makes one is its owner and invites anyone with a Park-Lane account by
 * code. Codes follow the unit invites' rules (ems/membership.ts): single use, 24 hours, stored keyed-hashed, and only
 * while their maker is still an owner of that Circle.
 *
 * Each member turns their own sharing on or off per Circle; nobody can do it for them, not even an owner. A member's
 * position and battery appear only in Circles where they share. When the last owner leaves, the longest-standing
 * member becomes owner; when the last member leaves, the Circle is gone.
 */

export const MAX_MEMBERS = 20;
export const MAX_CIRCLES_PER_PERSON = 10;
const MAX_OPEN_INVITES = 10;
const NAME_MAX = 40;

const hashOf = (code: string) => sign(`circle-invite:${code}`);

const notInCircle = () => new ApiError('not_found', 'That Circle doesn\'t exist, or you\'re not in it.');
const wrongCode = () => new ApiError('invalid', 'We couldn\'t find that code. Check it and try again, or ask for a new invite.');

function nameOf(input: unknown): string {
  const name = trimmedText(input, NAME_MAX);
  if (!name) {
    throw new ApiError('bad_request', 'Give the Circle a name, for example "Family".');
  }
  return name;
}

/** The person's membership of the Circle, or 404 (the same answer whether the Circle exists or not). */
function membership(user: User, circleId: string): circles.CircleMemberRow {
  const member = circles.findMember(circleId, user.id);
  if (!member) {
    throw notInCircle();
  }
  return member;
}

function ownerOf(user: User, circleId: string): void {
  if (membership(user, circleId).role !== 'owner') {
    throw new ApiError('forbidden', 'Only an owner of the Circle can do that.');
  }
}

const tellMembers = (circleId: string, extra: readonly string[] = []) =>
  publishToUsers([...circles.memberIdsOfCircle(circleId), ...extra], { type: 'circle.updated', circleId });

/** The Circle as `viewerId` sees it: everyone in it, with positions only of those who share here. */
function present(circle: circles.CircleRow, viewerId: string): Circle {
  const members = circles.listMembers(circle.id);
  const positions = findMemberLocations(members.filter((member) => member.sharing).map((member) => member.userId));
  const me = members.find((member) => member.userId === viewerId);
  return {
    id: circle.id,
    name: circle.name,
    role: me?.role ?? 'member',
    sharing: me?.sharing ?? false,
    members: members.map((member) => {
      const { location, battery } = member.sharing ? positionOf(member.userId, positions.get(member.userId)) : { location: null, battery: null };
      return {
        userId: member.userId,
        name: member.name,
        role: member.role,
        you: member.userId === viewerId,
        since: member.joinedAt,
        sharing: member.sharing,
        location,
        battery,
      };
    }),
  };
}

function circleFor(user: User, circleId: string): Circle {
  const circle = circles.findCircle(circleId);
  if (!circle) {
    throw notInCircle();
  }
  return present(circle, user.id);
}

export function listCircles(user: User): Circle[] {
  return circles.listCirclesOfUser(user.id).map((circle) => present(circle, user.id));
}

export function createCircle(user: User, nameInput: unknown, now = Date.now()): Circle {
  const name = nameOf(nameInput);
  if (circles.countCirclesOfUser(user.id) >= MAX_CIRCLES_PER_PERSON) {
    throw new ApiError('conflict', `You're in ${MAX_CIRCLES_PER_PERSON} Circles already. Leave one before making another.`);
  }
  const id = randomUUID();
  const at = new Date(now).toISOString();
  transaction(() => {
    circles.insertCircle({ id, name, createdBy: user.id, createdAt: at });
    circles.insertMember(id, user.id, 'owner', at);
  });
  return circleFor(user, id);
}

export function renameCircle(user: User, circleId: string, nameInput: unknown): Circle {
  ownerOf(user, circleId);
  circles.renameCircle(circleId, nameOf(nameInput));
  tellMembers(circleId);
  return circleFor(user, circleId);
}

export function deleteCircle(user: User, circleId: string): { deleted: true } {
  ownerOf(user, circleId);
  const memberIds = circles.memberIdsOfCircle(circleId);
  circles.deleteCircle(circleId);
  publishToUsers(memberIds, { type: 'circle.updated', circleId });
  return { deleted: true };
}

/** Turns the signed-in person's own sharing in the Circle on or off. */
export function setSharing(user: User, circleId: string, sharingInput: unknown): Circle {
  if (typeof sharingInput !== 'boolean') {
    throw new ApiError('bad_request', 'Say whether to share: true or false.');
  }
  membership(user, circleId);
  circles.setSharing(circleId, user.id, sharingInput);
  tellMembers(circleId);
  return circleFor(user, circleId);
}

// ---- members ----

/** Takes the person out of the Circle, handing ownership on or removing the Circle when they were the last. */
function leave(circleId: string, userId: string): boolean {
  const left = transaction(() => {
    if (!circles.deleteMember(circleId, userId)) {
      return false;
    }
    const rest = circles.listMembers(circleId);
    if (rest.length === 0) {
      circles.deleteCircle(circleId);
    } else if (!rest.some((member) => member.role === 'owner')) {
      circles.setMemberRole(circleId, rest[0].userId, 'owner');
    }
    return true;
  });
  if (left) {
    tellMembers(circleId, [userId]);
  }
  return left;
}

/** Removes a member (owners), or leaves the Circle when `userId` is the signed-in person's own. */
export function removeMember(user: User, circleId: string, userId: string): Circle[] {
  if (userId === user.id) {
    membership(user, circleId);
    leave(circleId, user.id);
    return listCircles(user);
  }
  ownerOf(user, circleId);
  if (!leave(circleId, userId)) {
    throw new ApiError('not_found', 'That person is not in this Circle.');
  }
  return listCircles(user);
}

/** For account deletion: leaves every Circle the way leaving one does. */
export function leaveAllCircles(userId: string): void {
  for (const circleId of circles.circleIdsOfUser(userId)) {
    leave(circleId, userId);
  }
}

// ---- invites ----

/** Whether whoever made the invite is still an owner of its Circle: a removed owner's codes stop working. */
const madeByCurrentOwner = (invite: invites.CircleInviteRow) => circles.findMember(invite.circleId, invite.createdBy)?.role === 'owner';

export function createInvite(user: User, circleId: string, now = Date.now()): CircleInvite {
  ownerOf(user, circleId);
  if (circles.countMembers(circleId) >= MAX_MEMBERS) {
    throw new ApiError('conflict', `This Circle has ${MAX_MEMBERS} people, the most it can have.`);
  }
  if (invites.countOpenCircleInvites(circleId, now) >= MAX_OPEN_INVITES) {
    throw new ApiError('rate_limited', `This Circle has ${MAX_OPEN_INVITES} invites waiting. Cancel one you don't need, or wait until they are used.`);
  }
  const code = newCode();
  const expiresAt = now + INVITE_TTL_MS;
  const id = invites.insertCircleInvite(hashOf(code), circleId, user.id, now, expiresAt);
  tellMembers(circleId);
  return { id, code, expiresAt };
}

export function listInvites(user: User, circleId: string, now = Date.now()): OpenCircleInvite[] {
  ownerOf(user, circleId);
  return invites
    .listOpenCircleInvites(circleId, now)
    .filter(madeByCurrentOwner)
    .map((invite) => ({ id: invite.id, invitedBy: invite.createdByName, createdAt: invite.createdAt, expiresAt: invite.expiresAt }));
}

export function cancelInvite(user: User, circleId: string, inviteId: string, now = Date.now()): OpenCircleInvite[] {
  ownerOf(user, circleId);
  if (!invites.deleteOpenCircleInvite(circleId, inviteId)) {
    throw new ApiError('not_found', 'That invite was already used or cancelled.');
  }
  tellMembers(circleId);
  return listInvites(user, circleId, now);
}

/** The invite a code names, if the signed-in person may still use it, or the reason not as an ApiError. */
function usableInvite(user: User, codeInput: unknown, now: number): { invite: invites.CircleInviteRow; circle: circles.CircleRow; alreadyMember: boolean } {
  const code = normalizeCode(codeInput);
  const invite = code.length === 9 ? invites.findCircleInvite(hashOf(code)) : null;
  const circle = invite ? circles.findCircle(invite.circleId) : null;
  if (!invite || !circle) {
    throw wrongCode();
  }
  if (circles.findMember(circle.id, user.id)) {
    return { invite, circle, alreadyMember: true };
  }
  if (invite.usedAt !== null) {
    throw new ApiError('invite_used', 'Someone already used this invite. Ask for a new one: each code works once.');
  }
  if (invite.expiresAt <= now || !madeByCurrentOwner(invite)) {
    throw new ApiError('invite_expired', 'This invite has expired. Codes work for 24 hours. Ask for a new one.');
  }
  if (circles.countMembers(circle.id) >= MAX_MEMBERS) {
    throw new ApiError('conflict', `This Circle has ${MAX_MEMBERS} people, the most it can have.`);
  }
  if (circles.countCirclesOfUser(user.id) >= MAX_CIRCLES_PER_PERSON) {
    throw new ApiError('conflict', `You're in ${MAX_CIRCLES_PER_PERSON} Circles already. Leave one before joining another.`);
  }
  return { invite, circle, alreadyMember: false };
}

export function checkInvite(user: User, codeInput: unknown, now = Date.now()): CircleInvitePreview {
  const { invite, circle, alreadyMember } = usableInvite(user, codeInput, now);
  return {
    circle: { name: circle.name, members: circles.countMembers(circle.id) },
    invitedBy: invite.createdByName,
    expiresAt: invite.expiresAt,
    alreadyMember,
  };
}

/** Joins with a code. Sharing starts off: the new member turns it on themselves. */
export function joinWithCode(user: User, codeInput: unknown, now = Date.now()): Circle {
  const { invite, circle, alreadyMember } = usableInvite(user, codeInput, now);
  if (!alreadyMember) {
    const joined = transaction(() => {
      if (!invites.takeCircleInvite(invite.codeHash, user.id, now)) {
        return false;
      }
      circles.insertMember(circle.id, user.id, 'member', new Date(now).toISOString());
      return true;
    });
    if (!joined) {
      throw new ApiError('invite_used', 'Someone already used this invite. Ask for a new one: each code works once.');
    }
    tellMembers(circle.id);
  }
  return circleFor(user, circle.id);
}
