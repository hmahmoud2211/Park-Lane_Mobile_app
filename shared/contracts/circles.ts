/**
 * Family Circle (backend/src/routes/circles.ts, docs/plans/FAMILY_CIRCLE_PLAN.md): groups of accounts that share
 * their phone's location and battery with each other, like Life360. A Circle is not tied to an apartment: its owner
 * invites anyone with a Park-Lane account by code. Everyone turns their own sharing on or off, per Circle, and is
 * seen only where they share. App sessions only, except POST /api/location/report, which also takes the narrow
 * `location` token a background task holds.
 */

export type CircleRole = 'owner' | 'member';

/** One position from the phone. */
export interface LocationPoint {
  /** Degrees, -90..90. */
  lat: number;
  /** Degrees, -180..180. */
  lng: number;
  /** How far off the position may be, in metres (at most 1000). */
  accuracyM: number;
  /** ISO time the phone took it. */
  at: string;
}

export interface BatteryInfo {
  /** 0..1 */
  level: number;
  charging: boolean;
}

/** POST /api/location/report: points the phone collected since its last report (1 to 200), and its battery. */
export interface LocationReport {
  points: LocationPoint[];
  battery: BatteryInfo | null;
}

/** The answer to a report. */
export interface LocationReportResult {
  /** Whether a point was newer than the saved one and replaced it. */
  accepted: boolean;
  /** False when the person shares in no Circle: the phone should stop its background updates. */
  sharing: boolean;
  /**
   * Someone in a Circle where the person shares has the map open: send fast ("live") updates until this time
   * (milliseconds since the epoch), then go back to normal ones. Null when nobody is watching.
   */
  liveUntil: number | null;
}

/**
 * POST /api/location/watch { circleId }: the map is open, so the Circle's sharing members go live for a minute. The
 * app repeats it about every 30 seconds while the map stays open (and stops after 10 minutes).
 */
export interface LiveWatch {
  /** Until when the members go live, unless watched again (milliseconds since the epoch). */
  liveUntil: number;
  /** How many members were asked to go live (the Circle's sharing members besides the watcher). */
  members: number;
}

/** A person's latest position and battery, as someone in a Circle with them sees it. */
export interface MemberPosition {
  userId: string;
  location: LocationPoint | null;
  battery: BatteryInfo | null;
}

export interface CircleMember extends MemberPosition {
  name: string;
  role: CircleRole;
  /** The signed-in person. */
  you: boolean;
  /** ISO time they joined the Circle. */
  since: string;
  /** Whether they share in this Circle. When false, `location` and `battery` are null. */
  sharing: boolean;
}

/** GET /api/circles answers a list of these; making, renaming, joining and sharing answer one. */
export interface Circle {
  id: string;
  name: string;
  /** The signed-in person's role here. */
  role: CircleRole;
  /** Whether the signed-in person shares in this Circle. */
  sharing: boolean;
  members: CircleMember[];
}

/** POST /api/circles/:id/invites (owners): a code another account enters to join; single use, 24 hours. */
export interface CircleInvite {
  /** For DELETE /api/circles/:id/invites/:inviteId. */
  id: string;
  /** Eight characters as XXXX-XXXX, without 0/O and 1/I. Shown this once: the backend keeps only its hash. */
  code: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** GET /api/circles/:id/invites (owners): the Circle's invites nobody has used yet, newest first. */
export interface OpenCircleInvite {
  id: string;
  invitedBy: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  expiresAt: number;
}

/**
 * POST /api/circles/invites/check { code }: what joining would do, so the app can ask "Join Family?". Refused like
 * joining: `invalid` (no such code), `invite_expired`, `invite_used`.
 */
export interface CircleInvitePreview {
  circle: { name: string; members: number };
  invitedBy: string;
  expiresAt: number;
  /** The signed-in account is already in this Circle. */
  alreadyMember: boolean;
}

/**
 * POST /api/location/token: a token that can only send location reports, for the phone's background task. It
 * never outlives the session that asked for it, and signing out ends it.
 */
export interface LocationToken {
  token: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}
