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
  /** Eight characters as XXXX-XXXX, without 0/O and 1/I. */
  code: string;
  role: UnitRole;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}
