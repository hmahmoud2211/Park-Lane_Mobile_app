import { audit } from '../clinic/audit.ts';
import type { User } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { deleteShare, listSharesOfProfile, shareUnit, upsertShare, type ShareAccess } from '../repositories/healthShares.ts';
import { findUnitOfUser, listMembers } from '../repositories/units.ts';
import { ownedProfile, profileById } from './passport.ts';

/**
 * Sharing a Health Passport profile with another resident of the same
 * apartment: a parent shares a child's record with the other parent, or an
 * adult shares their own. Only the profile's keeper shares it, so an adult's
 * own record is shared only by that adult. What each access allows is
 * decided in passport.ts (`accessTo`, `profileFor`).
 *
 * A share ends when the keeper stops it, when the other person leaves it,
 * when either of them withdraws Health Passport consent, or when either
 * leaves the apartment (the database's health_shares triggers).
 */

export interface ProfileShare {
  user_id: string;
  name: string;
  access: ShareAccess;
  since: string;
}

export interface ProfileSharing {
  /** False while the keeper belongs to no apartment: sharing is only between residents of one. */
  apartment: boolean;
  shares: ProfileShare[];
  /** The other residents of the apartment it isn't shared with yet. */
  members: { user_id: string; name: string }[];
}

const ACCESS: readonly ShareAccess[] = ['view', 'edit'];

/** Who the keeper shares the profile with, and with whom they could. */
export function sharingOf(userId: string, profileId: string): ProfileSharing {
  ownedProfile(userId, profileId);
  const unit = findUnitOfUser(userId);
  const shares = listSharesOfProfile(profileId).map((row) => ({ user_id: row.user_id, name: row.name, access: row.access, since: row.created_at }));
  const sharedWith = new Set(shares.map((share) => share.user_id));
  const members = unit
    ? listMembers(unit.id)
        .filter((member) => member.userId !== userId && !sharedWith.has(member.userId))
        .map((member) => ({ user_id: member.userId, name: member.name }))
    : [];
  return { apartment: unit !== null, shares, members };
}

/** Shares the profile with a resident of the keeper's apartment, or changes what they may do. */
export function shareProfile(user: User, profileId: string, targetId: string, input: Record<string, unknown>): ProfileSharing {
  ownedProfile(user.id, profileId);
  if (!ACCESS.includes(input.access as ShareAccess)) throw new ApiError('invalid', 'access must be view or edit.', 'access');
  if (targetId === user.id) throw new ApiError('invalid', 'This record is already yours.', 'user_id');
  if (!shareUnit(user.id, targetId)) throw new ApiError('not_found', 'That person is not a resident of your apartment.');
  const access = input.access as ShareAccess;
  upsertShare(profileId, targetId, access, new Date().toISOString());
  audit({ actor: user, action: 'passport.shared', patientProfileId: profileId, detail: { user_id: targetId, access } });
  return sharingOf(user.id, profileId);
}

/** The keeper stops sharing with someone, or the person it was shared with stops seeing it. */
export function endShare(user: User, profileId: string, targetId: string): void {
  if (targetId !== user.id) {
    ownedProfile(user.id, profileId);
  } else if (!profileById(profileId)) {
    throw new ApiError('not_found', 'Profile not found.');
  }
  if (!deleteShare(profileId, targetId)) throw new ApiError('not_found', 'This record is not shared with that person.');
  audit({ actor: user, action: 'passport.share_ended', patientProfileId: profileId, detail: { user_id: targetId } });
}
