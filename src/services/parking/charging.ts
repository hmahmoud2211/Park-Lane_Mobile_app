/**
 * EV charging: three separate things are tracked here.
 *
 *   - The reservation holds an EV bay for the parking stay.
 *   - The allocation holds a connector (and a share of its charger's
 *     concurrency) for the charging interval inside that stay.
 *   - The charging session records what physically happened: plug-in,
 *     simulated energy, completion, interruption.
 *
 * Gate entry never starts charging, and charging finishing never frees the
 * bay: only a parking exit, a "moved out of EV bay" event or an operator
 * resolution does that.
 *
 * All energy figures are simulated demo values. A real charger reports
 * metered energy over OCPP or the vendor's API; that feed replaces
 * `projectSession` and the sweep below.
 */
import { flagForReassignment, releaseAllocation } from './reservations';
import { MINUTE_MS, formatTime, iso, ms } from './time';
import { ParkingError, type Tx } from './tx';
import type { AuditActor, Charger, ChargingSession, ParkingDb, Reservation, Vehicle } from './types';

const HOUR_MS = 60 * MINUTE_MS;

/**
 * What an unknown visitor car is assumed to accept. Real acceptance varies by
 * model and state of charge, which is why every duration shown is an estimate.
 */
const ASSUMED_VISITOR_ACCEPTANCE = { maxAcKw: 11, maxDcKw: 50 };
/** Taper and losses, as a flat factor: a simplification for the demo. */
const DEMO_EFFICIENCY = 0.9;

export function chargingRateKw(charger: Charger, vehicle: Vehicle | undefined): number {
  const accepts = vehicle?.ev ?? ASSUMED_VISITOR_ACCEPTANCE;
  const vehicleLimit = charger.current === 'AC' ? accepts.maxAcKw : accepts.maxDcKw;
  return Math.round(Math.min(charger.powerKw, vehicleLimit) * DEMO_EFFICIENCY * 10) / 10;
}

export interface SessionProjection {
  energyKwh: number;
  /** 0-1 of the target, or of the reserved window when there is no target. */
  progress: number;
  /** When the simulation finishes: target reached or the window ends. */
  completesAt?: number;
  targetKwh?: number;
}

/** Simulated energy for a session at `now`, without writing anything. */
export function projectSession(db: ParkingDb, session: ChargingSession, now: number): SessionProjection {
  const allocation = db.allocations.find((a) => a.id === session.allocationId);
  const targetKwh = allocation?.targetKwh;
  if (session.state !== 'charging' || !session.startedAt || !allocation) {
    const progress = targetKwh ? Math.min(1, session.energyKwh / targetKwh) : session.state === 'completed' ? 1 : 0;
    return { energyKwh: session.energyKwh, progress, targetKwh };
  }
  const started = ms(session.startedAt);
  const windowEnd = ms(allocation.end);
  const byTarget = targetKwh && session.rateKw > 0 ? started + (targetKwh / session.rateKw) * HOUR_MS : Number.POSITIVE_INFINITY;
  const completesAt = Math.min(byTarget, windowEnd);
  const until = Math.min(now, completesAt);
  const energyKwh = Math.max(0, ((until - started) / HOUR_MS) * session.rateKw);
  const progress = targetKwh
    ? Math.min(1, energyKwh / targetKwh)
    : Math.min(1, (until - started) / Math.max(1, windowEnd - started));
  return { energyKwh: Math.round(energyKwh * 10) / 10, progress, completesAt, targetKwh };
}

/**
 * When the car must leave the EV bay after charging ends: the grace period,
 * or the end of the booked stay if that is later. A driver who booked the
 * bay for longer keeps it for the whole stay, extensions included, so this
 * is worked out from the booking as it stands rather than stored.
 */
export function moveOutDeadline(db: ParkingDb, session: ChargingSession): number | null {
  const r = db.reservations.find((x) => x.id === session.reservationId);
  if (!session.endedAt || !r) {
    return null;
  }
  return Math.max(ms(session.endedAt) + db.policy.evMoveOutGraceMinutes * MINUTE_MS, ms(r.scheduledEnd));
}

function sessionFor(tx: Tx, reservationId: string) {
  const session = tx.db.chargingSessions.find((s) => s.reservationId === reservationId);
  if (!session) {
    throw new ParkingError('no-charging', 'This booking has no charging slot.');
  }
  return session;
}

function finish(
  tx: Tx,
  session: ChargingSession,
  state: 'completed' | 'interrupted' | 'faulted',
  at: number,
  reason: string,
) {
  const projection = projectSession(tx.db, session, at);
  session.energyKwh = projection.energyKwh;
  session.state = state;
  session.endedAt = iso(at);
  session.endReason = reason;
  session.moveOutBy = iso(moveOutDeadline(tx.db, session)!);
  tx.touch(session);
  const allocation = tx.find('allocations', session.allocationId);
  // The connector is free again from the moment charging stops.
  if (allocation && allocation.status === 'active' && at < ms(allocation.end)) {
    allocation.end = iso(Math.max(at, ms(allocation.start)));
    tx.touch(allocation);
  }
}

function notifyMoveOut(tx: Tx, r: Reservation, title: string, body: string, moveOutBy: string) {
  const space = tx.get('spaces', r.spaceId);
  for (const audience of ['owner', 'visitor'] as const) {
    tx.notify({
      audience,
      residentId: audience === 'owner' ? r.residentId : undefined,
      reservationId: r.id,
      kind: 'charging-complete',
      title,
      body: `${body} Please move the vehicle out of ${space.label} by ${formatTime(moveOutBy)}.`,
    });
  }
}

/** The driver plugs in and charging starts. Entry alone never does this. */
export function plugIn(tx: Tx, reservationId: string, actor: AuditActor): ChargingSession {
  const r = tx.get('reservations', reservationId);
  if (r.status !== 'checked-in' || r.bayVacatedAt) {
    throw new ParkingError('not-in-bay', 'The vehicle must be checked in and in its EV bay to start charging.');
  }
  const session = sessionFor(tx, reservationId);
  if (session.state !== 'waiting-for-plug-in' && session.state !== 'reserved') {
    throw new ParkingError('session-state', 'This charging slot has already been used.');
  }
  const allocation = tx.get('allocations', session.allocationId);
  if (allocation.status !== 'active') {
    throw new ParkingError('slot-released', 'The charging slot for this booking was released.');
  }
  const charger = tx.get('chargers', allocation.chargerId);
  if (charger.status !== 'available') {
    throw new ParkingError('charger-down', `${charger.label} is not available right now. Security has been told.`);
  }
  if (tx.now < ms(allocation.start)) {
    throw new ParkingError('slot-not-started', `Your charging slot starts at ${formatTime(allocation.start)}.`);
  }
  if (tx.now >= ms(allocation.end)) {
    throw new ParkingError('slot-ended', 'The reserved charging time is over.');
  }
  const vehicle = tx.find('vehicles', r.vehicleId);
  session.state = 'charging';
  session.pluggedInAt = tx.nowIso;
  session.startedAt = tx.nowIso;
  session.rateKw = chargingRateKw(charger, vehicle);
  session.energyKwh = 0;
  tx.touch(session);
  tx.audit(actor, 'charging.started', 'chargingSession', session.id, `${charger.label} at ${session.rateKw} kW (simulated)`);
  return session;
}

/** Driver stops and unplugs, or security ends the session as part of a resolution. */
export function stopChargingInTx(tx: Tx, reservationId: string, actor: AuditActor, reason = 'Stopped and unplugged by driver') {
  const session = sessionFor(tx, reservationId);
  if (session.state !== 'charging') {
    throw new ParkingError('not-charging', 'Charging is not running.');
  }
  finish(tx, session, 'completed', tx.now, reason);
  tx.audit(actor, 'charging.stopped', 'chargingSession', session.id, reason);
  return session;
}

/** Demo: jump the simulation to its target now. */
export function simulateChargingComplete(tx: Tx, reservationId: string) {
  const session = sessionFor(tx, reservationId);
  if (session.state !== 'charging') {
    throw new ParkingError('not-charging', 'Start charging first.');
  }
  const allocation = tx.get('allocations', session.allocationId);
  const projection = projectSession(tx.db, session, tx.now);
  session.energyKwh = Math.max(projection.energyKwh, allocation.targetKwh ?? 0);
  session.state = 'completed';
  session.endedAt = tx.nowIso;
  session.endReason = 'Target reached (simulated)';
  session.moveOutBy = iso(moveOutDeadline(tx.db, session)!);
  tx.touch(session);
  if (tx.now < ms(allocation.end)) {
    allocation.end = tx.nowIso;
    tx.touch(allocation);
  }
  notifyMoveOut(tx, tx.get('reservations', reservationId), 'Charging complete', 'Charging finished.', session.moveOutBy);
  tx.audit('demo', 'charging.completed', 'chargingSession', session.id);
}

/**
 * A charger fault: active sessions on it are interrupted with the energy
 * delivered so far, their bays stay occupied, and upcoming bookings on it are
 * flagged for a compatible alternative.
 */
export function faultCharger(tx: Tx, chargerId: string, actor: AuditActor) {
  const charger = tx.get('chargers', chargerId);
  charger.status = 'faulted';
  tx.touch(charger);
  for (const allocation of tx.db.allocations) {
    if (allocation.chargerId !== chargerId || allocation.status !== 'active') continue;
    const session = tx.db.chargingSessions.find((s) => s.allocationId === allocation.id);
    const r = tx.get('reservations', allocation.reservationId);
    if (r.status === 'confirmed') {
      flagForReassignment(tx, r, `${charger.label} reported a fault. A compatible charger is needed.`);
    }
    if (session?.state === 'charging') {
      finish(tx, session, 'interrupted', tx.now, `${charger.label} reported a fault`);
      for (const audience of ['owner', 'operator', 'visitor'] as const) {
        tx.notify({
          audience,
          residentId: audience === 'owner' ? r.residentId : undefined,
          reservationId: r.id,
          kind: 'charger-fault',
          title: 'Charging interrupted',
          body: `${charger.label} reported a fault after ${session.energyKwh} kWh (simulated). The vehicle can stay in its bay until security helps.`,
        });
      }
    }
  }
  tx.audit(actor, 'charger.faulted', 'charger', charger.id, charger.label);
}

export function restoreCharger(tx: Tx, chargerId: string, actor: AuditActor) {
  const charger = tx.get('chargers', chargerId);
  charger.status = 'available';
  tx.touch(charger);
  tx.audit(actor, 'charger.restored', 'charger', charger.id, charger.label);
}

/**
 * The car left the EV bay but stays in the compound. Frees the bay (after
 * turnover) without recording a compound exit.
 */
export function markMovedOut(tx: Tx, reservationId: string, actor: AuditActor, note?: string) {
  const r = tx.get('reservations', reservationId);
  if (r.status !== 'checked-in') {
    throw new ParkingError('not-in-bay', 'Only a checked-in vehicle can be moved out of its bay.');
  }
  if (r.bayVacatedAt) {
    throw new ParkingError('already-vacated', 'The bay is already recorded as vacated.');
  }
  const session = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (session?.state === 'charging') {
    throw new ParkingError('charging-active', 'Stop charging and unplug before moving the vehicle.');
  }
  const space = tx.get('spaces', r.spaceId);
  r.bayVacatedAt = tx.nowIso;
  tx.touch(r);
  tx.create('occupancyEvents', 'occ', {
    at: tx.nowIso,
    spaceId: space.id,
    from: space.occupancy,
    to: 'vacant',
    source: 'bay-vacated',
    reservationId: r.id,
    note,
  });
  space.occupancy = 'vacant';
  space.occupancySince = tx.nowIso;
  space.occupiedByReservationId = undefined;
  tx.touch(space);
  releaseAllocation(tx, tx.find('allocations', r.chargingAllocationId), 'released');
  if (session && (session.state === 'reserved' || session.state === 'waiting-for-plug-in')) {
    session.state = 'completed';
    session.endedAt = tx.nowIso;
    session.endReason = 'Vehicle moved out before charging';
    tx.touch(session);
  }
  tx.audit(actor, 'bay.vacated', 'space', space.id, `${r.reference} moved out of ${space.label}`, note);
}

/** Advances every simulated session to `now`. Called by the scheduler. */
export function sweepCharging(tx: Tx) {
  for (const session of tx.db.chargingSessions) {
    const r = tx.find('reservations', session.reservationId);
    if (!r) continue;
    const allocation = tx.find('allocations', session.allocationId);

    if (session.state === 'charging' && allocation) {
      const projection = projectSession(tx.db, session, tx.now);
      if (projection.completesAt !== undefined && tx.now >= projection.completesAt) {
        const byWindow = projection.completesAt >= ms(allocation.end);
        finish(tx, session, 'completed', projection.completesAt, byWindow ? 'Reserved charging time ended' : 'Target reached');
        notifyMoveOut(
          tx,
          r,
          'Charging complete',
          byWindow ? 'The reserved charging time ended.' : 'Charging reached its target.',
          session.moveOutBy!,
        );
      } else if (Math.abs(projection.energyKwh - session.energyKwh) >= 0.1) {
        session.energyKwh = projection.energyKwh;
        tx.touch(session);
      }
    }

    // A slot nobody plugged into is released after the grace period.
    if (
      session.state === 'waiting-for-plug-in' &&
      allocation?.status === 'active' &&
      tx.now > ms(allocation.start) + tx.policy.chargingPlugInGraceMinutes * MINUTE_MS
    ) {
      session.state = 'interrupted';
      session.endedAt = tx.nowIso;
      session.endReason = 'Not plugged in within the grace period; the charging slot was released';
      tx.touch(session);
      releaseAllocation(tx, allocation, 'released');
    }

    // Charging is over and the car is still in the EV bay after its deadline.
    // The visit is overdue by then too, and the overdue alert tells the owner
    // and security; this marks the charging side for the session screen.
    const deadline = moveOutDeadline(tx.db, session);
    if (
      (session.state === 'completed' || session.state === 'interrupted') &&
      deadline !== null &&
      !session.moveOutOverstayAt &&
      r.status === 'checked-in' &&
      !r.bayVacatedAt &&
      tx.now > deadline
    ) {
      session.moveOutOverstayAt = tx.nowIso;
      session.moveOutBy = iso(deadline);
      tx.touch(session);
    }
  }
}
