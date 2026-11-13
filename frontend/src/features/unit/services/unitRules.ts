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

function shaped(text: string): string {
  const chars = codeCharacters(text);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

/** The code in an invite link (https://…/join#K7Q4-9MXD, https://…/join/K7Q4-9MXD or parklane://join/K7Q4-9MXD). */
const LINKED = /\/join[/#]([0-9A-Za-z]{4}-?[0-9A-Za-z]{4})(?![0-9A-Za-z])/;

/** The code an opened link carries (parklane://join/<code>, or the web page's address), or null for any other link. */
export function codeFromLink(url: string): string | null {
  const match = LINKED.exec(url);
  return match ? shaped(match[1]) : null;
}
/** A code as the backend writes it inside a message: capitals from its alphabet, so "Park-Lane" isn't one. */
const WRITTEN = /(?:^|[^0-9A-Za-z])([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})(?![0-9A-Za-z])/;

/**
 * The invite code in a link or a whole pasted invite message, shaped as XXXX-XXXX, or null if the
 * text holds none. The backend reads pasted text the same way (backend/src/ems/membership.ts).
 */
export function codeFromText(text: string): string | null {
  const match = LINKED.exec(text) ?? WRITTEN.exec(text);
  return match ? shaped(match[1]) : null;
}

/**
 * The code field's text as typed: capitals, the dash put in after four characters (and gone
 * again when deleting back to four), anything else dropped. A pasted code with spaces or a
 * lowercase one comes out the same as one typed carefully, and pasting the whole invite
 * message or its link leaves just the code.
 */
export function formatCodeInput(text: string): string {
  return (text.length > 9 ? codeFromText(text) : null) ?? shaped(text);
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
 * What the owner sends: the text arrives outside the app, so it leads with the link (one tap
 * opens the app on the invite) and also says where to type the code by hand. Null once the code
 * has expired, when there is nothing worth sending.
 */
export function inviteMessage(
  invite: Pick<UnitInvite, 'code' | 'expiresAt'> & { link?: string | null },
  nowMs: number = Date.now(),
  appName: string = brand.appName,
): string | null {
  const validity = inviteValidity(invite.expiresAt, nowMs);
  if (!validity) {
    return null;
  }
  const unit = validity.unit === 'hours' ? 'hour' : 'minute';
  const valid = `(valid ${validity.count} ${unit}${validity.count === 1 ? '' : 's'})`;
  const byHand = `open Settings → Household and enter code ${invite.code} ${valid}`;
  return invite.link
    ? `Join our apartment in the ${appName} app. Tap this link: ${invite.link}\nOr ${byHand}`
    : `Join our apartment in the ${appName} app: ${byHand}`;
}

export interface InviteProblem {
  title: string;
  message: string;
  /** Typing again can help (a wrong or mistyped code); otherwise only a new invite from the owner does. */
  retype: boolean;
}

/** How a refused code reads, from the backend's error code and message. */
export function inviteProblem(code: string | null, message: string): InviteProblem {
  switch (code) {
    case 'invalid':
      return { title: 'Code not found', message, retype: true };
    case 'invite_expired':
      return { title: 'This invite has expired', message, retype: false };
    case 'invite_used':
      return { title: 'This invite was already used', message, retype: false };
    case 'conflict':
      return { title: 'You are already in an apartment', message, retype: false };
    case 'rate_limited':
      return { title: 'Too many tries', message: 'Wait a minute, then try again.', retype: true };
    case 'network':
    case 'timeout':
      return { title: 'No connection', message: 'Check your internet connection, then try again.', retype: true };
    default:
      return { title: 'Something went wrong', message, retype: true };
  }
}

/** Who an open invite was for and how long it still works, for the owner's list. */
export function openInviteLabel(role: UnitInvite['role'], expiresAt: number, nowMs: number = Date.now()): string {
  const validity = inviteValidity(expiresAt, nowMs);
  const who = role === 'owner' ? 'Owner invite' : 'Invite';
  if (!validity) return `${who}, expired`;
  const unit = validity.unit === 'hours' ? 'hour' : 'minute';
  return `${who}, works ${validity.count} more ${unit}${validity.count === 1 ? '' : 's'}`;
}
