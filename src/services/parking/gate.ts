/**
 * Gate decisions for scanned passes. Every barrier action here is simulated.
 *
 * Validation runs against the store inside a transaction, never against
 * what a phone displays, so a screenshot of an old pass is worth nothing once
 * its credential is revoked or used. A real deployment moves this module
 * behind the gate controller's API unchanged in spirit: hash the scanned
 * token, look it up server-side, decide, then open the barrier.
 *
 * Note: a gate scan proves a car entered the parking area, not that it
 * reached its bay. This demo marks the assigned bay occupied on entry; a real
 * site would confirm that with bay sensors or the operator.
 */
import { blockStart, checkSpace, isOverdue, overlaps, reservationBlock } from './availability';
import { stopChargingInTx } from './charging';
import { findCredentialByToken, flagForReassignment, releaseAllocation } from './reservations';
import { MINUTE_MS, formatTime, ms } from './time';
import { ParkingError, type Tx } from './tx';
import type { Gate, QrCredential, Reservation, ScanDirection, ScanOutcome } from './types';

export interface ScanResult {
  outcome: ScanOutcome;
  /** Machine-readable reason, e.g. `wrong-gate`. */
  code: string;
  title: string;
  message: string;
  /** The barrier opened (simulated). */
  gateOpened: boolean;
  reservationId?: string;
}

const TOKEN_PATTERN = /plq_[A-Za-z0-9_-]{16,}/;
const INVITE_PATTERN = /inv_[A-Za-z0-9_-]{16,}/;

/** Pulls a gate credential out of a scan or a pasted string. */
export function extractCredentialToken(input: string): string | null {
  return input.match(TOKEN_PATTERN)?.[0] ?? null;
}

function record(
  tx: Tx,
  gate: Gate,
  direction: ScanDirection,
  result: ScanResult,
  credential?: QrCredential,
  overrideReason?: string,
): ScanResult {
  tx.create('scanEvents', 'scn', {
    at: tx.nowIso,
    gateId: gate.id,
    direction,
    outcome: result.outcome,
    code: result.code,
    message: result.message,
    reservationId: result.reservationId,
    credentialId: credential?.id,
    simulated: true,
    operatorOverride: overrideReason ? { reason: overrideReason } : undefined,
  });
  return result;
}

const reject = (code: string, title: string, message: string, reservationId?: string): ScanResult => ({
  outcome: 'rejected',
  code,
  title,
  message,
  gateOpened: false,
  reservationId,
});

function gateFor(tx: Tx, gateId: string, direction: ScanDirection): Gate {
  const gate = tx.get('gates', gateId);
  if (gate.direction !== 'both' && gate.direction !== direction) {
    throw new ParkingError(
      'gate-direction',
      `${gate.name} is ${gate.direction === 'exit' ? 'an exit' : 'an entry'} gate. Choose a gate that handles ${direction}.`,
    );
  }
  return gate;
}

/** Entry rules after the credential itself has been accepted (or overridden). */
function entryProblem(tx: Tx, r: Reservation, gate: Gate): ScanResult | null {
  const { policy } = tx;
  const space = tx.get('spaces', r.spaceId);
  const start = ms(r.scheduledStart);
  const opensAt = start - policy.earlyArrivalMinutes * MINUTE_MS;

  if (tx.now < opensAt) {
    return reject(
      'too-early',
      'Too early',
      `Entry for this visit opens at ${formatTime(opensAt)} (${policy.earlyArrivalMinutes} min before the ${formatTime(start)} booking).`,
      r.id,
    );
  }
  if (tx.now >= ms(r.scheduledEnd)) {
    return reject('expired', 'Visit time has ended', 'The booked time for this pass is over.', r.id);
  }
  if (!r.vehiclePlate) {
    return reject(
      'vehicle-missing',
      'Vehicle details missing',
      'Add the vehicle plate on the guest pass, or ask security to record it, before entering.',
      r.id,
    );
  }
  const zone = tx.get('zones', space.zoneId);
  if (!gate.zoneIds.includes(space.zoneId)) {
    const correct = tx.find('gates', space.gateId);
    return reject(
      'wrong-gate',
      'Wrong gate',
      `This pass is for ${zone.name}. Please use ${correct?.name ?? 'the gate shown on the pass'}.`,
      r.id,
    );
  }
  if (space.serviceability !== 'in-service') {
    return reject(
      'space-unavailable',
      'Assigned bay unavailable',
      `${space.label} is ${space.serviceability === 'maintenance' ? 'under maintenance' : 'out of service'}. Security will assign another bay.`,
      r.id,
    );
  }
  if (space.occupancy !== 'vacant') {
    return reject(
      'space-occupied',
      'Assigned bay not free',
      `${space.label} is ${space.occupancy === 'unknown' ? 'reporting an unknown status' : 'still occupied'}. Security will assign another bay.`,
      r.id,
    );
  }
  // Another visit still holding the bay, e.g. an overstay that is now resolved on paper only.
  const now = { start: tx.now, end: tx.now + 1 };
  for (const other of tx.db.reservations) {
    if (other.id === r.id || other.spaceId !== r.spaceId) continue;
    const block = reservationBlock(other, policy, tx.now);
    if (block && block.reason === 'turnover' && overlaps(block, now)) {
      return reject(
        'space-turnover',
        'Bay being prepared',
        `${space.label} was just vacated and is being prepared. Entry opens at ${formatTime(block.end)}.`,
        r.id,
      );
    }
    if (block && block.reason !== 'reserved' && overlaps(block, now)) {
      return reject('space-conflict', 'Assigned bay not free', `${space.label} is still held by another visit.`, r.id);
    }
  }
  if (tx.now < start) {
    const early = checkSpace(tx.db, space, { start: tx.now, end: start }, tx.now, r.id);
    if (!early.available) {
      return reject(
        'early-conflict',
        'Too early for this bay',
        `${space.label} is booked until shortly before your time. Entry opens at ${formatTime(start)}.`,
        r.id,
      );
    }
  }
  return null;
}

function admit(tx: Tx, r: Reservation, gate: Gate, credential?: QrCredential) {
  const space = tx.get('spaces', r.spaceId);
  r.status = 'checked-in';
  r.actualEntryAt = tx.nowIso;
  r.entryGateId = gate.id;
  // Early arrival moves the held interval forward, atomically with the entry.
  if (tx.now < blockStart(r)) {
    r.effectiveStart = tx.nowIso;
  }
  r.needsReassignment = undefined;
  tx.touch(r);
  if (credential) {
    credential.entryUsedAt = tx.nowIso;
    tx.touch(credential);
  }

  tx.create('occupancyEvents', 'occ', {
    at: tx.nowIso,
    spaceId: space.id,
    from: space.occupancy,
    to: 'occupied',
    source: 'gate-entry',
    reservationId: r.id,
  });
  space.occupancy = 'occupied';
  space.occupancySince = tx.nowIso;
  space.occupiedByReservationId = r.id;
  tx.touch(space);

  tx.create('sessions', 'pks', {
    reservationId: r.id,
    spaceId: space.id,
    enteredAt: tx.nowIso,
    entryGateId: gate.id,
  });

  // Entering does not start charging; the driver plugs in separately.
  const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (charging && charging.state === 'reserved') {
    charging.state = 'waiting-for-plug-in';
    tx.touch(charging);
  }

  tx.notify({
    audience: 'owner',
    residentId: r.residentId,
    reservationId: r.id,
    kind: 'entry',
    title: `${r.guest?.name ?? 'Your vehicle'} has arrived`,
    body: `Entered at ${gate.name}, parking in ${space.label}.`,
  });
}

function depart(tx: Tx, r: Reservation, gate: Gate, credential?: QrCredential) {
  const space = tx.get('spaces', r.spaceId);
  r.status = 'completed';
  r.actualExitAt = tx.nowIso;
  r.exitGateId = gate.id;
  tx.touch(r);
  // A completed pass can never authorise again, whichever credential it was.
  const active = credential ?? tx.find('credentials', r.credentialId);
  if (active) {
    active.exitUsedAt = tx.nowIso;
    active.status = 'consumed';
    tx.touch(active);
  }

  if (space.occupiedByReservationId === r.id) {
    tx.create('occupancyEvents', 'occ', {
      at: tx.nowIso,
      spaceId: space.id,
      from: space.occupancy,
      to: 'vacant',
      source: 'gate-exit',
      reservationId: r.id,
    });
    space.occupancy = 'vacant';
    space.occupancySince = tx.nowIso;
    space.occupiedByReservationId = undefined;
    tx.touch(space);
  }

  const session = tx.db.sessions.find((s) => s.reservationId === r.id && !s.exitedAt);
  if (session) {
    session.exitedAt = tx.nowIso;
    session.exitGateId = gate.id;
    tx.touch(session);
  }

  releaseAllocation(tx, tx.find('allocations', r.chargingAllocationId), 'released');
  const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (charging && (charging.state === 'reserved' || charging.state === 'waiting-for-plug-in')) {
    charging.state = 'completed';
    charging.endedAt = tx.nowIso;
    charging.endReason = 'Vehicle left without charging';
    tx.touch(charging);
  }

  // Overdue alerts are settled by the departure.
  for (const n of tx.db.notifications) {
    if (n.reservationId === r.id && n.audience === 'operator' && !n.resolvedAt && n.kind === 'overdue') {
      n.resolvedAt = tx.nowIso;
      tx.touch(n);
    }
  }

  tx.notify({
    audience: 'owner',
    residentId: r.residentId,
    reservationId: r.id,
    kind: 'exit',
    title: `${r.guest?.name ?? 'Your vehicle'} has left`,
    body: `Exited at ${gate.name}. ${space.label} is released after a ${tx.policy.turnoverBufferMinutes}-minute turnover.`,
  });
}

/** Exit rules once the visit is known to be checked in. */
function exitProblem(tx: Tx, r: Reservation): ScanResult | null {
  const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (charging?.state === 'charging') {
    const space = tx.get('spaces', r.spaceId);
    return reject(
      'charging-active',
      'Charging still running',
      `Stop charging and unplug at ${space.label} from the app first, or ask security to end the session. ` +
        'This is a booking rule only: security can always open the barrier in an emergency.',
      r.id,
    );
  }
  return null;
}

/** Validates a scanned or pasted pass at a gate and applies the result. */
export function scanPass(tx: Tx, input: string, gateId: string, direction: ScanDirection): ScanResult {
  const gate = gateFor(tx, gateId, direction);
  const token = extractCredentialToken(input);
  if (!token) {
    if (INVITE_PATTERN.test(input)) {
      return record(
        tx,
        gate,
        direction,
        reject(
          'invitation-link',
          'Not a gate pass',
          'That is the invitation link, which only shows the pass. Scan the QR on it, or use a manual resolution.',
        ),
      );
    }
    return record(tx, gate, direction, reject('unreadable', 'Code not recognised', 'This is not a Park Lane pass.'));
  }

  const credential = findCredentialByToken(tx.db, token);
  if (!credential) {
    return record(tx, gate, direction, reject('unknown-pass', 'Pass not found', 'No booking matches this pass.'));
  }
  const r = tx.get('reservations', credential.reservationId);

  if (direction === 'entry') {
    if (r.status === 'checked-in') {
      // Idempotent, whether it entered by this QR or by a manual resolution:
      // no new transition and no new gate event.
      return {
        outcome: 'already-processed',
        code: 'already-checked-in',
        title: 'Already checked in',
        message: `Entered at ${formatTime(r.actualEntryAt!)}. No further action needed.`,
        gateOpened: false,
        reservationId: r.id,
      };
    }
    if (r.status === 'completed' || credential.status === 'consumed') {
      return record(
        tx,
        gate,
        direction,
        reject('pass-used', 'Pass already used', 'This visit is complete. A new reservation is needed to enter again.', r.id),
        credential,
      );
    }
    if (credential.status === 'revoked') {
      const why =
        credential.revokeReason === 'replaced'
          ? 'A newer pass was issued for this visit. Use the latest QR.'
          : credential.revokeReason === 'no-show'
            ? 'The visitor did not arrive within the grace period, so the booking expired.'
            : credential.revokeReason === 'cancelled'
              ? 'The resident cancelled this booking.'
              : 'This pass was withdrawn.';
      return record(tx, gate, direction, reject(`revoked-${credential.revokeReason ?? 'other'}`, 'Pass not valid', why, r.id), credential);
    }
    if (r.status !== 'confirmed') {
      return record(tx, gate, direction, reject('not-eligible', 'Pass not valid', 'This booking cannot enter now.', r.id), credential);
    }
    const problem = entryProblem(tx, r, gate);
    if (problem) {
      if (problem.code === 'space-occupied' || problem.code === 'space-unavailable' || problem.code === 'space-conflict') {
        flagForReassignment(tx, r, problem.message);
      }
      return record(tx, gate, direction, problem, credential);
    }
    admit(tx, r, gate, credential);
    const space = tx.get('spaces', r.spaceId);
    return record(
      tx,
      gate,
      direction,
      {
        outcome: 'accepted',
        code: 'entry-ok',
        title: 'Gate opened',
        message: `${r.guest?.name ?? 'Resident'} · ${r.vehiclePlate} · park in ${space.label}.`,
        gateOpened: true,
        reservationId: r.id,
      },
      credential,
    );
  }

  // Exit
  if (r.status === 'completed') {
    return {
      outcome: 'already-processed',
      code: 'already-checked-out',
      title: 'Already checked out',
      message: `Left at ${formatTime(r.actualExitAt!)}. No further action needed.`,
      gateOpened: false,
      reservationId: r.id,
    };
  }
  if (r.status !== 'checked-in') {
    return record(
      tx,
      gate,
      direction,
      reject('not-checked-in', 'No entry recorded', 'This pass has not been used to enter, so it cannot exit.', r.id),
      credential,
    );
  }
  if (credential.status === 'revoked') {
    return record(
      tx,
      gate,
      direction,
      reject('revoked', 'Pass not valid', 'This pass was withdrawn. Security can record the exit manually.', r.id),
      credential,
    );
  }
  const problem = exitProblem(tx, r);
  if (problem) {
    return record(tx, gate, direction, problem, credential);
  }
  const overdue = isOverdue(r, tx.now);
  depart(tx, r, gate, credential);
  return record(
    tx,
    gate,
    direction,
    {
      outcome: 'accepted',
      code: overdue ? 'exit-ok-overdue' : 'exit-ok',
      title: 'Gate opened',
      message: overdue
        ? `Overdue visit closed. ${r.guest?.name ?? 'Driver'} has left.`
        : `${r.guest?.name ?? 'Driver'} has left. Thank you for visiting.`,
      gateOpened: true,
      reservationId: r.id,
    },
    credential,
  );
}

/* ------------------------------------------------ Operator resolutions */

function assertReason(reason: string) {
  if (reason.trim().length < 3) {
    throw new ParkingError('reason-required', 'Record a short reason for this override.');
  }
}

/**
 * Lost or unreadable pass at entry: the operator identifies the visit and
 * admits it. Every booking rule still applies; only the QR is bypassed.
 */
export function operatorEntry(tx: Tx, reservationId: string, gateId: string, reason: string, plate?: string): ScanResult {
  assertReason(reason);
  const gate = gateFor(tx, gateId, 'entry');
  const r = tx.get('reservations', reservationId);
  if (r.status === 'checked-in') {
    return { outcome: 'already-processed', code: 'already-checked-in', title: 'Already checked in', message: 'No change made.', gateOpened: false, reservationId: r.id };
  }
  if (r.status !== 'confirmed') {
    return record(tx, gate, 'entry', reject('not-eligible', 'Cannot admit', `This booking is ${r.status}.`, r.id), undefined, reason);
  }
  if (plate && !r.vehiclePlate) {
    r.vehiclePlate = plate.trim().toUpperCase();
  }
  const problem = entryProblem(tx, r, gate);
  if (problem) {
    return record(tx, gate, 'entry', problem, undefined, reason);
  }
  admit(tx, r, gate);
  tx.audit('operator', 'gate.manual-entry', 'reservation', r.id, gate.name, reason);
  return record(
    tx,
    gate,
    'entry',
    { outcome: 'accepted', code: 'entry-override', title: 'Gate opened (manual)', message: `Admitted by security: ${reason}`, gateOpened: true, reservationId: r.id },
    undefined,
    reason,
  );
}

/**
 * Lost pass, unreadable code, or a stuck charging session at exit. Departure
 * is never blocked by the booking's end time; an active charging session is
 * stopped and logged as part of the resolution.
 */
export function operatorExit(tx: Tx, reservationId: string, gateId: string, reason: string): ScanResult {
  assertReason(reason);
  const gate = gateFor(tx, gateId, 'exit');
  const r = tx.get('reservations', reservationId);
  if (r.status === 'completed') {
    return { outcome: 'already-processed', code: 'already-checked-out', title: 'Already checked out', message: 'No change made.', gateOpened: false, reservationId: r.id };
  }
  if (r.status !== 'checked-in') {
    return record(tx, gate, 'exit', reject('not-checked-in', 'No entry recorded', 'There is no visit inside to close.', r.id), undefined, reason);
  }
  const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (charging?.state === 'charging') {
    stopChargingInTx(tx, r.id, 'operator', `Stopped by security: ${reason}`);
  }
  depart(tx, r, gate);
  tx.audit('operator', 'gate.manual-exit', 'reservation', r.id, gate.name, reason);
  return record(
    tx,
    gate,
    'exit',
    { outcome: 'accepted', code: 'exit-override', title: 'Gate opened (manual)', message: `Exit recorded by security: ${reason}`, gateOpened: true, reservationId: r.id },
    undefined,
    reason,
  );
}
