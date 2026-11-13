/**
 * The resident's apartment, its members, and owner invites (backend/src/routes/unit.ts). App sessions only.
 *
 * Joining with an invite code puts the signed-in account in the unit, so it sees the unit's brand-account devices
 * (Home Assistant) and reaches its CUBE gateway through the account (GatewayPass). Removing a member ends both:
 * Home Assistant at once, the gateway within about five minutes (its member check).
 */

export type UnitRole = 'owner' | 'member';

export interface UnitMember {
  userId: string;
  name: string;
  /** Shown to owners only; null for members. */
  email: string | null;
  role: UnitRole;
  /** The signed-in resident. */
  you: boolean;
  /** ISO time they joined the unit. */
  since: string;
}

/** GET /api/unit (404 `no_home` without one), and the answer of join and member removal. */
export interface MyUnit {
  unit: { id: string; name: string; building: string | null };
  role: UnitRole;
  members: UnitMember[];
}

/** POST /api/unit/invites { role? } (owners only): a code another account enters to join; single use, 24 hours. */
export interface UnitInvite {
  /** Names the invite in the owner's list (OpenUnitInvite.id) and for DELETE /api/unit/invites/:id. */
  id: string;
  /** Eight characters as XXXX-XXXX, without 0/O and 1/I. Shown this once: the backend keeps only its hash. */
  code: string;
  /**
   * A web address that opens the app on this invite (GET /join/<code>, a page with an "Open the app" button,
   * the store link and the code). Null when the backend has no PUBLIC_URL; then share the code alone.
   */
  link: string | null;
  role: UnitRole;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** GET /api/unit/invites (owners): the apartment's invites nobody has used yet, newest first. Codes are not shown again. */
export interface OpenUnitInvite {
  id: string;
  role: UnitRole;
  /** The owner who made it. */
  invitedBy: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  expiresAt: number;
}

/**
 * POST /api/unit/invites/check { code }: what joining would do, before joining, so the app can ask
 * "Join Tower A · 1203?". Refused like joining: `invalid` (no such code), `invite_expired`, `invite_used`.
 */
export interface UnitInvitePreview {
  unit: { name: string; building: string | null };
  /** The owner who sent it. */
  invitedBy: string;
  role: UnitRole;
  expiresAt: number;
  /** The signed-in account is already in this apartment: there is nothing to join. */
  alreadyMember: boolean;
}
