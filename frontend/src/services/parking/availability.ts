/**
 * Availability rules. Pure functions of the store and a clock reading, so the
 * booking flow, the gate and the dashboard all reach the same answer.
 *
 * Intervals are half-open, [start, end). A stay blocks its bay from its start
 * until its end plus the turnover buffer. Reservation status and physical
 * occupancy are separate inputs: a future booking blocks only its own
 * interval, while a car that is physically there blocks the bay now.
 */
import type { PolicySettings } from './policy';
import { MINUTE_MS, ms } from './time';
import type {
  Charger,
  ChargingAllocation,
  Connector,
  ConnectorType,
  ParkingDb,
  ParkingSpace,
  Reservation,
  SpaceKind,
} from './types';

export interface Interval {
  start: number;
  end: number;
}

export interface Block extends Interval {
  reservationId?: string;
  reason: string;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

const bufferMs = (policy: PolicySettings) => policy.turnoverBufferMinutes * MINUTE_MS;

/** Start of the interval a reservation holds, moved earlier by an early arrival. */
export function blockStart(r: Reservation): number {
  const scheduled = ms(r.scheduledStart);
  return r.effectiveStart ? Math.min(ms(r.effectiveStart), scheduled) : scheduled;
}

/** A checked-in visit whose booked end has passed while the car is still in its bay. */
export function isOverdue(r: Reservation, now: number): boolean {
  return r.status === 'checked-in' && !r.bayVacatedAt && now >= ms(r.scheduledEnd);
}

/**
 * The time a reservation keeps its bay from other bookings, or null once it
 * holds nothing.
 *
 * - Confirmed: its booked interval plus turnover.
 * - Checked in: the same, but open-ended once overdue, because the car is
 *   still there and nobody else can be sent to the bay until it leaves.
 * - Completed, or the bay vacated: up to the actual departure plus turnover,
 *   which releases the unused rest of the booking.
 * - Cancelled and no-show: nothing.
 */
export function reservationBlock(r: Reservation, policy: PolicySettings, now: number): Block | null {
  const start = blockStart(r);
  const buffer = bufferMs(policy);
  switch (r.status) {
    case 'cancelled':
    case 'no-show':
      return null;
    case 'confirmed':
      return { start, end: ms(r.scheduledEnd) + buffer, reservationId: r.id, reason: 'reserved' };
    case 'checked-in': {
      if (r.bayVacatedAt) {
        return { start, end: ms(r.bayVacatedAt) + buffer, reservationId: r.id, reason: 'turnover' };
      }
      if (isOverdue(r, now)) {
        return { start, end: Number.POSITIVE_INFINITY, reservationId: r.id, reason: 'overstay' };
      }
      return { start, end: ms(r.scheduledEnd) + buffer, reservationId: r.id, reason: 'occupied' };
    }
    case 'completed': {
      const left = r.bayVacatedAt ?? r.actualExitAt;
      return {
        start,
        end: (left ? ms(left) : ms(r.scheduledEnd)) + buffer,
        reservationId: r.id,
        reason: 'turnover',
      };
    }
  }
}

/** A car in the bay that no session accounts for holds it until someone resolves it. */
export function hasUnexplainedOccupancy(space: ParkingSpace): boolean {
  return space.occupancy !== 'vacant' && !space.occupiedByReservationId;
}

export interface SpaceCheck {
  available: boolean;
  /** Plain-language reason when not available. */
  reason?: string;
  conflictReservationId?: string;
}

/**
 * Whether a bay can take a stay over [start, end), ignoring `excludeId` (the
 * reservation being edited, so it never conflicts with itself).
 */
export function checkSpace(
  db: ParkingDb,
  space: ParkingSpace,
  interval: Interval,
  now: number,
  excludeId?: string,
): SpaceCheck {
  if (space.serviceability !== 'in-service') {
    return {
      available: false,
      reason: space.serviceability === 'maintenance' ? 'Under maintenance' : 'Out of service',
    };
  }
  const requested = { start: interval.start, end: interval.end + bufferMs(db.policy) };
  if (hasUnexplainedOccupancy(space) && requested.end > now) {
    return {
      available: false,
      reason: space.occupancy === 'unknown' ? 'Bay status unknown' : 'Occupied by an unregistered vehicle',
    };
  }
  for (const r of db.reservations) {
    if (r.spaceId !== space.id || r.id === excludeId) {
      continue;
    }
    const block = reservationBlock(r, db.policy, now);
    if (block && overlaps(block, requested)) {
      return {
        available: false,
        reason: block.reason === 'overstay' ? 'Held by an overstaying vehicle' : 'Booked for part of this time',
        conflictReservationId: r.id,
      };
    }
  }
  return { available: true };
}

/** Bays of a kind that are free and in service right now, the dashboard's "available now". */
export function isAvailableNow(db: ParkingDb, space: ParkingSpace, now: number): boolean {
  if (space.occupancy !== 'vacant' || space.serviceability !== 'in-service') {
    return false;
  }
  const instant = { start: now, end: now + 1 };
  return !db.reservations.some((r) => {
    if (r.spaceId !== space.id) {
      return false;
    }
    // Includes the turnover after a departure: the bay is being prepared, so it cannot be booked now either.
    const block = reservationBlock(r, db.policy, now);
    return block !== null && overlaps(block, instant);
  });
}

/* ------------------------------------------------------------ Charging */

const allocationInterval = (a: ChargingAllocation): Interval => ({ start: ms(a.start), end: ms(a.end) });

/**
 * The most of `intervals` in force at any one moment within `window`. Two
 * back-to-back stays never count together, since intervals are half-open.
 */
export function peakOverlap(intervals: Interval[], window: Interval): number {
  const relevant = intervals.filter((i) => overlaps(i, window));
  const points = new Set<number>([window.start]);
  for (const i of relevant) {
    if (i.start > window.start && i.start < window.end) {
      points.add(i.start);
    }
  }
  let peak = 0;
  for (const point of points) {
    const at = { start: point, end: point + 1 };
    peak = Math.max(peak, relevant.filter((i) => overlaps(i, at)).length);
  }
  return peak;
}

export interface ConnectorCheck {
  available: boolean;
  reason?: string;
}

/**
 * Whether a connector can be held for [start, end): its charger must be in
 * service, the connector free, and the charger below its concurrency limit
 * for the whole interval.
 */
export function checkConnector(
  db: ParkingDb,
  connector: Connector,
  interval: Interval,
  excludeReservationId?: string,
): ConnectorCheck {
  const charger = db.chargers.find((c) => c.id === connector.chargerId);
  if (!charger || charger.status !== 'available') {
    return { available: false, reason: chargerStatusLabel(charger) };
  }
  const live = db.allocations.filter(
    (a) => a.status === 'active' && a.chargerId === charger.id && a.reservationId !== excludeReservationId,
  );
  if (live.some((a) => a.connectorId === connector.id && overlaps(allocationInterval(a), interval))) {
    return { available: false, reason: 'Connector booked for part of this time' };
  }
  if (peakOverlap(live.map(allocationInterval), interval) + 1 > charger.maxConcurrent) {
    return { available: false, reason: 'Charger at capacity for part of this time' };
  }
  return { available: true };
}

export function chargerStatusLabel(charger: Charger | undefined): string {
  switch (charger?.status) {
    case 'available':
      return 'Available';
    case 'faulted':
      return 'Charger fault';
    case 'maintenance':
      return 'Charger under maintenance';
    case 'offline':
    default:
      return 'Charger offline';
  }
}

/** Chargers free to start a session now: in service and below their limit. */
export function chargerFreeNow(db: ParkingDb, charger: Charger, now: number): boolean {
  if (charger.status !== 'available') {
    return false;
  }
  const charging = db.chargingSessions.filter((s) => {
    if (s.state !== 'charging') {
      return false;
    }
    const allocation = db.allocations.find((a) => a.id === s.allocationId);
    return allocation?.chargerId === charger.id;
  }).length;
  const heldNow = db.allocations.filter(
    (a) => a.status === 'active' && a.chargerId === charger.id && overlaps(allocationInterval(a), { start: now, end: now + 1 }),
  ).length;
  return Math.max(charging, heldNow) < charger.maxConcurrent;
}

/* -------------------------------------------------------------- Search */

export interface SearchRequest {
  propertyId: string;
  kind: SpaceKind;
  start: number;
  end: number;
  /** EV only. */
  connectorType?: ConnectorType;
  chargingStart?: number;
  chargingEnd?: number;
  /** The reservation being edited, so its own hold does not count. */
  excludeReservationId?: string;
}

export interface SpaceOption {
  space: ParkingSpace;
  available: boolean;
  reason?: string;
  /** Walking distance to the property (map units); smaller is closer. */
  distance: number;
  /** EV only: the connector that would be held. */
  connectorId?: string;
}

const pathLength = (points: readonly { x: number; y: number }[]) =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

/**
 * How far a bay is from a property, for recommending the nearest: the walk
 * from the bay to its building's entrance (or lift), plus the stroll across
 * the compound when that is not the property's own building.
 */
export function walkingDistance(db: ParkingDb, space: ParkingSpace, propertyId: string): number {
  const property = db.properties.find((p) => p.id === propertyId);
  const walk = pathLength(space.route.walk?.points ?? []);
  if (!property || property.buildingId === space.buildingId) {
    return walk;
  }
  const door = db.buildings.find((b) => b.id === space.buildingId)?.door ?? property.mapEntrance;
  return walk + Math.hypot(door.x - property.mapEntrance.x, door.y - property.mapEntrance.y);
}

/**
 * Every bay of the requested kind, with whether it can be booked for the
 * whole request and why not, nearest to the property first. For EV bays the
 * bay and a compatible connector must both be free.
 */
export function searchSpaces(db: ParkingDb, request: SearchRequest, now: number): SpaceOption[] {
  const options = db.spaces
    .filter((space) => space.kind === request.kind)
    .map<SpaceOption>((space) => {
      const distance = walkingDistance(db, space, request.propertyId);
      const bay = checkSpace(db, space, request, now, request.excludeReservationId);
      if (!bay.available) {
        return { space, available: false, reason: bay.reason, distance };
      }
      if (request.kind !== 'ev') {
        return { space, available: true, distance };
      }
      const connectors = db.connectors.filter((c) => c.spaceId === space.id);
      const compatible = connectors.filter((c) => c.type === request.connectorType);
      if (compatible.length === 0) {
        return { space, available: false, reason: `No ${request.connectorType} connector at this bay`, distance };
      }
      const chargingInterval = {
        start: request.chargingStart ?? request.start,
        end: request.chargingEnd ?? request.end,
      };
      let lastReason = 'Charger unavailable';
      for (const connector of compatible) {
        const check = checkConnector(db, connector, chargingInterval, request.excludeReservationId);
        if (check.available) {
          return { space, available: true, distance, connectorId: connector.id };
        }
        lastReason = check.reason ?? lastReason;
      }
      return { space, available: false, reason: lastReason, distance };
    });

  return options.sort((a, b) => Number(b.available) - Number(a.available) || a.distance - b.distance);
}
