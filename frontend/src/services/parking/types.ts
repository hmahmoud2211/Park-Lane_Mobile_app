/**
 * Data model for visitor parking, gate access and EV charging.
 *
 * Every timestamp is an unambiguous UTC ISO string (`...Z`). Africa/Cairo is
 * applied only when reading input and formatting output (see time.ts).
 * Scheduled times (what was booked) are kept apart from actual times (what
 * happened at the gate or charger), so history survives early exits,
 * overstays and no-shows.
 *
 * Mutable records carry `version`, bumped on every write, so a stale edit can
 * be refused instead of silently overwriting a newer one.
 */

import type { PolicySettings } from './policy';

export type IsoTime = string;

export interface Entity {
  id: string;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  version: number;
}

/* ---------------------------------------------------------------- Site */

/** A point on the internal site map (SVG units, see site.ts). */
export interface MapPoint {
  x: number;
  y: number;
}

/** The compound's levels; each has its own map canvas. */
export type LevelId = 'ground' | 'b1' | 'b2';

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RouteStepKind = 'enter' | 'head' | 'continue' | 'turn-left' | 'turn-right' | 'ramp' | 'park' | 'walk';

/** Where the walk from a bay ends: a building entrance, or a lift up to its lobby. */
export type WalkTarget = { kind: 'entrance'; building: string } | { kind: 'lift'; lift: string; building: string };

/**
 * The facts behind a step, kept apart from its wording so it can be written
 * in any language (see i18n.ts). Each kind uses its own fields.
 */
export interface RouteStepInfo {
  gateId?: string;
  /** Road or aisle name, as named in site.ts. */
  road?: string;
  heading?: 'north' | 'south' | 'east' | 'west';
  turn?: 'left' | 'right';
  afterRamp?: boolean;
  toLevel?: LevelId;
  bay?: string;
  ordinal?: number;
  side?: 'left' | 'right';
  walkTo?: WalkTarget;
}

/**
 * One instruction of the way from a gate to a bay, with the stretch of the
 * map it covers so the map can highlight it.
 */
export interface RouteStep {
  kind: RouteStepKind;
  levelId: LevelId;
  info: RouteStepInfo;
  /** The English wording: "Turn left onto Central Avenue". */
  text: string;
  points: MapPoint[];
}

/**
 * The way to a bay, worked out from the site's road graph (see routing.ts):
 * the drive from the vehicle entrance, then the walk from the bay to the
 * building.
 */
export interface SpaceRoute {
  steps: RouteStep[];
  walk?: RouteStep;
}

/** Demo latitude/longitude. Fictional values; replace through site config. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Building extends Entity {
  name: string;
  /** Footprint on the ground-level map. */
  map: MapRect;
  /** The pedestrian entrance, where walking directions end. */
  door: MapPoint;
}

export interface Property extends Entity {
  /** e.g. "Apartment A-302". */
  label: string;
  buildingId: string;
  /** The resident's own bay, if the property has one. */
  assignedSpaceId?: string;
  /** Entrance door on the site map, used to rank nearby visitor bays. */
  mapEntrance: MapPoint;
}

export interface Resident extends Entity {
  name: string;
  phone: string;
  email: string;
}

export type PropertyRole = 'owner' | 'tenant';

export interface PropertyAssociation extends Entity {
  residentId: string;
  propertyId: string;
  role: PropertyRole;
}

export type ConnectorType = 'Type 2' | 'CCS2' | 'CHAdeMO' | 'GB/T';

export interface Vehicle extends Entity {
  /** The owning resident; guest vehicles live on the reservation instead. */
  residentId: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  plateCountry: string;
  /** Present for an electric vehicle. */
  ev?: {
    connectors: ConnectorType[];
    /** What the car itself accepts, which may be below the charger's rating. */
    maxAcKw: number;
    maxDcKw: number;
    batteryKwh: number;
  };
}

export type GateDirection = 'entry' | 'exit' | 'both';

export interface Gate extends Entity {
  name: string;
  /** "North entrance, off Park Avenue": what a driver looks for. */
  description: string;
  direction: GateDirection;
  /** Zones a vehicle may reach after entering here. */
  zoneIds: string[];
  geo: GeoPoint;
  map: MapPoint;
}

export type SpaceKind = 'visitor' | 'ev' | 'resident';

export interface ParkingZone extends Entity {
  name: string;
  /** "Ground", "Basement 1". */
  level: string;
  levelId: LevelId;
  indoor: boolean;
  kind: SpaceKind;
}

export type Serviceability = 'in-service' | 'maintenance' | 'out-of-service';
export type OccupancyState = 'vacant' | 'occupied' | 'unknown';

export interface ParkingSpace extends Entity {
  label: string;
  zoneId: string;
  kind: SpaceKind;
  buildingId: string;
  /** The vehicle entrance a driver should use for this bay. */
  gateId: string;
  serviceability: Serviceability;
  /**
   * Physical state, separate from any booking. In this demo it is set by
   * simulated gate events, bay sensors or the operator.
   */
  occupancy: OccupancyState;
  occupancySince: IsoTime;
  /** Set when a session explains the occupancy; absent for an unexplained car. */
  occupiedByReservationId?: string;
  /** Outdoor bays only: indoor bays are found by level and landmarks, not GPS. */
  geo?: GeoPoint;
  levelId: LevelId;
  /** The bay's outline on its level's map. */
  map: MapRect;
  /** Turn-by-turn route from the bay's gate, computed from the road graph. */
  route: SpaceRoute;
  /** The route as one paragraph, for sharing: "Enter at Gate 2. Head west…". */
  instructions: string;
}

/* ---------------------------------------------------------- Charging */

export type ChargerStatus = 'available' | 'faulted' | 'maintenance' | 'offline';

export interface Charger extends Entity {
  label: string;
  current: 'AC' | 'DC';
  powerKw: number;
  status: ChargerStatus;
  /** Where the charging post stands on the EV hub's map. */
  map: MapPoint & { levelId: LevelId };
  /**
   * Vehicles that may charge at once. A charger with two connectors and a
   * limit of one cannot charge two cars together.
   */
  maxConcurrent: number;
}

export interface Connector extends Entity {
  chargerId: string;
  type: ConnectorType;
  /** The EV bay this connector's cable reaches. */
  spaceId: string;
}

export type AllocationStatus = 'active' | 'released' | 'cancelled';

/** A charging resource held for an interval inside a parking reservation. */
export interface ChargingAllocation extends Entity {
  reservationId: string;
  chargerId: string;
  connectorId: string;
  start: IsoTime;
  end: IsoTime;
  status: AllocationStatus;
  targetKwh?: number;
  targetPercent?: number;
}

export type ChargingState =
  | 'reserved'
  | 'waiting-for-plug-in'
  | 'charging'
  | 'completed'
  | 'interrupted'
  | 'faulted';

export interface ChargingSession extends Entity {
  allocationId: string;
  reservationId: string;
  state: ChargingState;
  pluggedInAt?: IsoTime;
  startedAt?: IsoTime;
  endedAt?: IsoTime;
  /** Simulated delivery; demo values, not metered. */
  energyKwh: number;
  /** Charging rate the simulation uses, after vehicle and charger limits. */
  rateKw: number;
  endReason?: string;
  /**
   * When charging ended, the time the car had to leave the EV bay by (see
   * charging.ts `moveOutDeadline`, which follows later extensions).
   */
  moveOutBy?: IsoTime;
  /** Set once the car stayed in the EV bay past that deadline. */
  moveOutOverstayAt?: IsoTime;
}

/* ------------------------------------------------------- Reservations */

export type ReservationStatus = 'confirmed' | 'checked-in' | 'completed' | 'cancelled' | 'no-show';

export type BookedFor = 'guest' | 'resident';
export type ParkingType = 'standard' | 'ev';

export interface GuestDetails {
  name: string;
  phone?: string;
  email?: string;
}

export interface Reservation extends Entity {
  /** Short reference shown to people, e.g. "PL-4821". */
  reference: string;
  propertyId: string;
  residentId: string;
  bookedFor: BookedFor;
  guest?: GuestDetails;
  /** Empty until someone adds it; entry requires it. */
  vehiclePlate?: string;
  /** For the resident's own EV bookings. */
  vehicleId?: string;
  parkingType: ParkingType;
  spaceId: string;
  status: ReservationStatus;

  scheduledStart: IsoTime;
  scheduledEnd: IsoTime;
  /** Set when an early arrival moves the start of the blocked interval forward. */
  effectiveStart?: IsoTime;

  actualEntryAt?: IsoTime;
  actualExitAt?: IsoTime;
  entryGateId?: string;
  exitGateId?: string;
  /** For EV bays: the car left the bay but stayed in the compound. */
  bayVacatedAt?: IsoTime;

  cancelledAt?: IsoTime;
  noShowAt?: IsoTime;

  /** A known overstay or charger fault means this booking needs another bay. */
  needsReassignment?: { reason: string; flaggedAt: IsoTime };
  /** The owner and operator were told the visit is overdue. */
  overdueNotifiedAt?: IsoTime;

  chargingAllocationId?: string;
  invitationId: string;
  credentialId: string;
}

/** The link a visitor opens to see their pass. Not a gate credential. */
export interface GuestInvitation extends Entity {
  reservationId: string;
  /** Opaque, unguessable token in the invitation URL. */
  inviteToken: string;
  revokedAt?: IsoTime;
}

export type CredentialStatus = 'active' | 'revoked' | 'consumed';

/**
 * The credential the gate validates. Only its hash is used for lookup, as a
 * real server would. The raw token is kept on the record solely so this
 * single-device demo can redraw the QR; a backend would return it to the
 * invitation viewer and never store it in plain form.
 */
export interface QrCredential extends Entity {
  reservationId: string;
  tokenHash: string;
  /** Demo only: see the note above. */
  displayToken: string;
  status: CredentialStatus;
  issuedAt: IsoTime;
  revokedAt?: IsoTime;
  revokeReason?: string;
  entryUsedAt?: IsoTime;
  exitUsedAt?: IsoTime;
}

export interface ParkingSession extends Entity {
  reservationId: string;
  spaceId: string;
  enteredAt: IsoTime;
  entryGateId: string;
  exitedAt?: IsoTime;
  exitGateId?: string;
  /** How the session ended, if not by a normal exit scan. */
  resolution?: string;
}

/* ------------------------------------------------------------ Events */

export type ScanDirection = 'entry' | 'exit';
export type ScanOutcome = 'accepted' | 'rejected' | 'already-processed';

export interface GateScanEvent extends Entity {
  at: IsoTime;
  gateId: string;
  direction: ScanDirection;
  outcome: ScanOutcome;
  /** Machine-readable reason, e.g. `wrong-gate`. */
  code: string;
  message: string;
  reservationId?: string;
  credentialId?: string;
  /** Every gate action in this demo is simulated. */
  simulated: true;
  operatorOverride?: { reason: string };
}

export type OccupancySource =
  | 'gate-entry'
  | 'gate-exit'
  | 'bay-vacated'
  | 'operator'
  | 'demo'
  | 'seed';

export interface OccupancyEvent extends Entity {
  at: IsoTime;
  spaceId: string;
  from: OccupancyState;
  to: OccupancyState;
  source: OccupancySource;
  reservationId?: string;
  note?: string;
}

export type NotificationAudience = 'owner' | 'operator' | 'visitor';

export interface AppNotification extends Entity {
  at: IsoTime;
  audience: NotificationAudience;
  residentId?: string;
  reservationId?: string;
  kind:
    | 'overdue'
    | 'reassignment-needed'
    | 'charging-complete'
    | 'charger-fault'
    | 'no-show'
    | 'help-request'
    | 'entry'
    | 'exit';
  title: string;
  body: string;
  readAt?: IsoTime;
  /** Operator items that need action, e.g. a visitor's "space occupied" report. */
  resolvedAt?: IsoTime;
}

export type AuditActor = 'resident' | 'visitor' | 'operator' | 'system' | 'demo';

export interface AuditEvent extends Entity {
  at: IsoTime;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
  reason?: string;
}

/* ------------------------------------------------------------ Store */

export interface ParkingDb {
  schemaVersion: number;
  policy: PolicySettings;
  /** Bumped on every committed write; a cheap change marker for the UI. */
  revision: number;
  /** The demo clock's offset from real time, in ms. See clock.ts. */
  clockOffsetMs: number;
  /** Serial for human-readable references. */
  referenceSerial: number;

  buildings: Building[];
  properties: Property[];
  residents: Resident[];
  associations: PropertyAssociation[];
  vehicles: Vehicle[];
  zones: ParkingZone[];
  spaces: ParkingSpace[];
  gates: Gate[];
  chargers: Charger[];
  connectors: Connector[];

  reservations: Reservation[];
  invitations: GuestInvitation[];
  credentials: QrCredential[];
  sessions: ParkingSession[];
  allocations: ChargingAllocation[];
  chargingSessions: ChargingSession[];

  scanEvents: GateScanEvent[];
  occupancyEvents: OccupancyEvent[];
  notifications: AppNotification[];
  audit: AuditEvent[];
}
