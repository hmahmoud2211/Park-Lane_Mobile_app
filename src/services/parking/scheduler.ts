/**
 * Time-driven rules: no-show expiry, overdue visits, bookings that need a new
 * bay, and charging progress.
 *
 * The sweep runs at the start of every transaction (so a gate scan always
 * sees expiries that fell due while the app was closed), on a timer while the
 * app is open, and after the demo clock moves. It is idempotent: running it
 * twice at the same instant changes nothing the second time.
 *
 * In production this is a server job (cron or a queue), with the same
 * on-demand check repeated wherever a decision is made.
 */
import { checkConnector, checkSpace, hasUnexplainedOccupancy, isOverdue, reservationBlock } from './availability';
import { sweepCharging } from './charging';
import { flagForReassignment, releaseAllocation, revokeCredential } from './reservations';
import { DAY_MS, MINUTE_MS, formatTime, iso, ms } from './time';
import type { Tx } from './tx';
import type { Reservation } from './types';

/** Upcoming bookings this close are checked for a bay or charger problem. */
const LOOKAHEAD_MS = DAY_MS;

function expireNoShows(tx: Tx) {
  const grace = tx.policy.lateArrivalGraceMinutes * MINUTE_MS;
  for (const r of tx.db.reservations) {
    if (r.status !== 'confirmed') continue;
    const deadline = ms(r.scheduledStart) + grace;
    if (tx.now <= deadline) continue;
    r.status = 'no-show';
    // The actual expiry moment, even if nobody was looking at the time.
    r.noShowAt = iso(Math.min(deadline, ms(r.scheduledEnd)));
    r.needsReassignment = undefined;
    tx.touch(r);
    revokeCredential(tx, r.credentialId, 'no-show');
    releaseAllocation(tx, tx.find('allocations', r.chargingAllocationId), 'cancelled');
    const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
    if (charging && charging.state === 'reserved') {
      charging.endReason = 'Booking expired before arrival';
      tx.touch(charging);
    }
    tx.notify({
      audience: 'owner',
      residentId: r.residentId,
      reservationId: r.id,
      kind: 'no-show',
      title: `${r.guest?.name ?? 'Booking'} did not arrive`,
      body: `${r.reference} expired at ${formatTime(r.noShowAt)}, ${tx.policy.lateArrivalGraceMinutes} minutes after the booked arrival. The space was released and the pass no longer works.`,
    });
    tx.audit('system', 'reservation.no-show', 'reservation', r.id, r.reference);
  }
}

function notifyOverdue(tx: Tx) {
  for (const r of tx.db.reservations) {
    if (!isOverdue(r, tx.now) || r.overdueNotifiedAt) continue;
    r.overdueNotifiedAt = tx.nowIso;
    tx.touch(r);
    const space = tx.get('spaces', r.spaceId);
    const who = r.guest?.name ?? 'The resident’s vehicle';
    tx.notify({
      audience: 'owner',
      residentId: r.residentId,
      reservationId: r.id,
      kind: 'overdue',
      title: `${who} is overdue`,
      body: `The visit was booked until ${formatTime(r.scheduledEnd)}. ${space.label} stays reserved until the vehicle leaves. You can extend the visit if the bay is free.`,
    });
    tx.notify({
      audience: 'operator',
      reservationId: r.id,
      kind: 'overdue',
      title: `Overstay in ${space.label}`,
      body: `${who} (${r.vehiclePlate ?? 'no plate'}) was due out at ${formatTime(r.scheduledEnd)}.`,
    });
    tx.audit('system', 'reservation.overdue', 'reservation', r.id, space.label);
  }
}

/** Why an upcoming booking cannot be served as planned, or null if it can. */
function upcomingProblem(tx: Tx, r: Reservation): string | null {
  const space = tx.get('spaces', r.spaceId);
  if (space.serviceability !== 'in-service') {
    return `${space.label} is ${space.serviceability === 'maintenance' ? 'under maintenance' : 'out of service'}.`;
  }
  if (hasUnexplainedOccupancy(space)) {
    return `${space.label} is occupied by a vehicle without a booking.`;
  }
  for (const other of tx.db.reservations) {
    if (other.id === r.id || other.spaceId !== r.spaceId) continue;
    const block = reservationBlock(other, tx.policy, tx.now);
    if (block?.reason === 'overstay') {
      return `${space.label} is still occupied by an overstaying vehicle.`;
    }
  }
  const allocation = tx.find('allocations', r.chargingAllocationId);
  if (allocation && allocation.status === 'active') {
    const charger = tx.get('chargers', allocation.chargerId);
    if (charger.status !== 'available') {
      return `${charger.label} is ${charger.status}. A compatible charger is needed.`;
    }
  }
  return null;
}

function reviewUpcoming(tx: Tx) {
  for (const r of tx.db.reservations) {
    if (r.status !== 'confirmed' || ms(r.scheduledStart) > tx.now + LOOKAHEAD_MS) continue;
    const problem = upcomingProblem(tx, r);
    if (problem) {
      flagForReassignment(tx, r, problem);
    } else if (r.needsReassignment) {
      // The cause cleared, e.g. the overstaying car left: double-check the bay first.
      const space = tx.get('spaces', r.spaceId);
      const bay = checkSpace(tx.db, space, { start: ms(r.scheduledStart), end: ms(r.scheduledEnd) }, tx.now, r.id);
      const allocation = tx.find('allocations', r.chargingAllocationId);
      const connector = tx.find('connectors', allocation?.connectorId);
      const plug =
        allocation && connector
          ? checkConnector(tx.db, connector, { start: ms(allocation.start), end: ms(allocation.end) }, r.id)
          : { available: true };
      if (bay.available && plug.available) {
        r.needsReassignment = undefined;
        tx.touch(r);
        for (const n of tx.db.notifications) {
          if (n.reservationId === r.id && n.kind === 'reassignment-needed' && !n.resolvedAt) {
            n.resolvedAt = tx.nowIso;
            tx.touch(n);
          }
        }
      }
    }
  }
}

export function runScheduledRules(tx: Tx) {
  expireNoShows(tx);
  notifyOverdue(tx);
  sweepCharging(tx);
  reviewUpcoming(tx);
}
