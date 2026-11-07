import { brand } from '../../../config/brand';
import type { MyUnit, UnitInvite, UnitMember } from '../types';

/**
 * Rules for the apartment's members and invite codes, with no React or network, so they are
 * checked on their own (unitRules.checks.ts).
 */

const CODE_LENGTH = 8;

/** The letters and digits typed so far, in capitals, at most a code's worth. */
function codeCharacters(text: string): string {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

/**
 * The code field's text as typed: capitals, the dash put in after four characters (and gone
 * again when deleting back to four), anything else dropped. A pasted code with spaces or a
 * lowercase one comes out the same as one typed carefully.
 */
export function formatCodeInput(text: string): string {
  const chars = codeCharacters(text);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

/** Eight characters typed: worth sending (the backend says whether it is a real code). */
export function isCodeComplete(text: string): boolean {
  return codeCharacters(text).length === CODE_LENGTH;
}

export interface MemberRow extends UnitMember {
  /** Owners remove anyone but themselves; the backend refuses removing yourself. */
  removable: boolean;
}

const ROLE_ORDER = { owner: 0, member: 1 } as const;

/** You first, then owners, then members, each by name. */
export function memberRows(unit: MyUnit): MemberRow[] {
  return [...unit.members]
    .sort((a, b) => Number(b.you) - Number(a.you) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId))
    .map((member) => ({ ...member, removable: unit.role === 'owner' && !member.you }));
}

export type InviteValidity = { unit: 'hours' | 'minutes'; count: number };

/** How much longer an invite works, rounded down (with a minute's grace for the round trip), or null once expired. */
export function inviteValidity(expiresAt: number, nowMs: number): InviteValidity | null {
  const left = expiresAt - nowMs;
  if (left <= 0) {
    return null;
  }
  const hours = Math.floor((left + 60_000) / 3_600_000);
  return hours >= 1 ? { unit: 'hours', count: hours } : { unit: 'minutes', count: Math.max(1, Math.floor(left / 60_000)) };
}

/**
 * What the owner sends: the text arrives outside the app, so it says where to go and what to
 * type. Null once the code has expired, when there is nothing worth sending.
 */
export function inviteMessage(invite: Pick<UnitInvite, 'code' | 'expiresAt'>, nowMs: number = Date.now(), appName: string = brand.appName): string | null {
  const validity = inviteValidity(invite.expiresAt, nowMs);
  if (!validity) {
    return null;
  }
  const unit = validity.unit === 'hours' ? 'hour' : 'minute';
  return `Join our apartment in the ${appName} app: sign in, then enter code ${invite.code} (valid ${validity.count} ${unit}${validity.count === 1 ? '' : 's'})`;
}
