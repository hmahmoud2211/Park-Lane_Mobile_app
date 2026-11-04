/**
 * Reservation lifecycle: create, edit, extend, cancel, replace the pass and
 * reassign the bay. Each function runs inside one repository transaction, so
 * its availability check and its writes are a single atomic step; a thrown
 * ParkingError discards the whole draft and leaves the original booking as
 * it was.
 */
import {
  blockStart,
  checkConnector,
  checkSpace,
  isOverdue,
  overlaps,
  peakOverlap,
  searchSpaces,
} from './availability';
import { newToken, sha256 } from './crypto';
import { DAY_MS, MINUTE_MS, formatTime, iso, ms } from './time';
import { ParkingError, type Tx } from './tx';
import type {
  AuditActor,
  BookedFor,
  ChargingAllocation,
  ConnectorType,
  GuestDetails,
  ParkingDb,
  ParkingType,
  QrCredential,
  Reservation,
} from './types';

export interface ChargingRequest {
  connectorType: ConnectorType;
  start: number;
  end: number;
  targetKwh?: number;
  targetPercent?: number;
}

export interface ReservationInput {
  propertyId: string;
  residentId: string;
  bookedFor: BookedFor;
  guest?: GuestDetails;
  /** Leave empty when the visitor will add it from their pass. */
  vehiclePlate?: string;
  vehicleId?: string;
  parkingType: ParkingType;
  start: number;
  end: number;
  spaceId: string;
  charging?: ChargingRequest;
}

/** Latin or Arabic letters, digits and spaces, as Egyptian plates are written. */
const PLATE_PATTERN = /^[A-Z0-9\u0600-\u06FF ]{2,12}$/;

export function normalisePlate(plate: string | undefined): string | undefined {
  const cleaned = plate?.trim().toUpperCase().replace(/\s+/g, ' ');
  return cleaned ? cleaned : undefined;
}

export function assertPlate(plate: string | undefined) {
  if (plate && !PLATE_PATTERN.test(plate)) {
    throw new ParkingError('invalid-plate', 'Enter the plate as letters and numbers, e.g. EGY 1234.');
  }
}

/** The interval a reservation is expected to occupy, for the per-property limit. */
function activeInterval(r: Reservation, now: number) {
  return {
    start: blockStart(r),
    end: isOverdue(r, now) ? Number.POSITIVE_INFINITY : ms(r.scheduledEnd),
  };
}

/** Most guest bookings a property holds at any one moment within `window`. */
function guestPeak(db: ParkingDb, propertyId: string, window: { start: number; end: number }, now: number, excludeId?: string) {
  const held = db.reservations
    .filter(
      (r) =>
        r.propertyId === propertyId &&
        r.bookedFor === 'guest' &&
        r.id !== excludeId &&
        (r.status === 'confirmed' || r.status === 'checked-in'),
    )
    .map((r) => activeInterval(r, now));
  return peakOverlap(held, window);
}

/** Rules that do not depend on a particular bay. Throws the first one broken. */
export function validateRequest(db: ParkingDb, input: ReservationInput, now: number, excludeId?: string) {
  const { policy } = db;
  const { start, end } = input;

  const association = db.associations.find(
    (a) => a.propertyId === input.propertyId && a.residentId === input.residentId,
  );
  if (!association) {
    throw new ParkingError('not-your-property', 'You can only book for a property you are registered to.');
  }
  if (!(end > start)) {
    throw new ParkingError('invalid-time', 'Departure must be after arrival.');
  }
  if (start < now - policy.startTolerancePastMinutes * MINUTE_MS && !excludeId) {
    throw new ParkingError('in-past', 'Arrival time has already passed. Choose a later time.');
  }
  if (end <= now) {
    throw new ParkingError('in-past', 'Departure time has already passed.');
  }
  if (start > now + policy.bookingHorizonDays * DAY_MS) {
    throw new ParkingError(
      'beyond-horizon',
      `Bookings can be made up to ${policy.bookingHorizonDays} days ahead.`,
    );
  }
  const minutes = (end - start) / MINUTE_MS;
  const maxMinutes =
    input.parkingType === 'ev' ? policy.maxEvParkingDurationMinutes : policy.maxStandardDurationMinutes;
  if (minutes > maxMinutes) {
    throw new ParkingError('too-long', `A stay can be at most ${maxMinutes / 60} hours.`);
  }
  if (input.bookedFor === 'guest' && !input.guest?.name.trim()) {
    throw new ParkingError('guest-name', 'Enter your guest’s name.');
  }
  assertPlate(normalisePlate(input.vehiclePlate));

  if (input.bookedFor === 'guest') {
    const peak = guestPeak(db, input.propertyId, { start, end }, now, excludeId);
    if (peak >= policy.maxSimultaneousGuestBookingsPerProperty) {
      throw new ParkingError(
        'guest-limit',
        `This property already has ${peak} guests booked for part of that time. Up to ${policy.maxSimultaneousGuestBookingsPerProperty} can park at once.`,
      );
    }
  }

  if (input.parkingType === 'ev') {
    const charging = input.charging;
    if (!charging) {
      throw new ParkingError('charging-missing', 'Choose a charging time.');
    }
    if (charging.start < start || charging.end > end) {
      throw new ParkingError('charging-outside', 'Charging must start and end within the parking time.');
    }
    if (!(charging.end > charging.start)) {
      throw new ParkingError('invalid-time', 'Charging must end after it starts.');
    }
    if ((charging.end - charging.start) / MINUTE_MS > policy.maxChargingDurationMinutes) {
      throw new ParkingError(
        'charging-too-long',
        `A charging slot can be at most ${policy.maxChargingDurationMinutes / 60} hours.`,
      );
    }
  }
}

/** Finds a compatible free connector for an EV bay, or throws why not. */
function pickConnector(tx: Tx, spaceId: string, charging: ChargingRequest, excludeId?: string) {
  const compatible = tx.db.connectors.filter((c) => c.spaceId === spaceId && c.type === charging.connectorType);
  if (compatible.length === 0) {
    throw new ParkingError('incompatible', `This bay has no ${charging.connectorType} connector.`);
  }
  let reason = 'No charger is free for that time.';
  for (const connector of compatible) {
    const check = checkConnector(tx.db, connector, charging, excludeId);
    if (check.available) {
      return connector;
    }
    reason = check.reason ?? reason;
  }
  throw new ParkingError('charger-unavailable', `${reason}. Choose another bay or time.`);
}

function assertBayFree(tx: Tx, spaceId: string, start: number, end: number, excludeId?: string) {
  const space = tx.get('spaces', spaceId);
  const check = checkSpace(tx.db, space, { start, end }, tx.now, excludeId);
  if (!check.available) {
    throw new ParkingError(
      'space-unavailable',
      `${space.label} is not free for that whole time (${check.reason?.toLowerCase()}). Choose another space.`,
    );
  }
  return space;
}

function issueCredential(tx: Tx, reservationId: string): QrCredential {
  const token = newToken('plq');
  return tx.create('credentials', 'crd', {
    reservationId,
    tokenHash: sha256(token),
    displayToken: token,
    status: 'active',
    issuedAt: tx.nowIso,
  });
}

/** Looks a scanned token up by its hash, as a server would. */
export function findCredentialByToken(db: ParkingDb, token: string): QrCredential | undefined {
  const hash = sha256(token);
  return db.credentials.find((c) => c.tokenHash === hash);
}

export function createReservation(tx: Tx, input: ReservationInput, actor: AuditActor = 'resident'): Reservation {
  validateRequest(tx.db, input, tx.now);
  const space = assertBayFree(tx, input.spaceId, input.start, input.end);
  const wantKind = input.parkingType === 'ev' ? 'ev' : 'visitor';
  if (input.bookedFor === 'resident' && input.parkingType !== 'ev') {
    throw new ParkingError('invalid-type', 'Residents book EV charging here; your own bay is always yours.');
  }
  if (space.kind !== wantKind) {
    throw new ParkingError('wrong-kind', `${space.label} is not a ${wantKind === 'ev' ? 'EV' : 'visitor'} bay.`);
  }
  const connector = input.charging ? pickConnector(tx, space.id, input.charging) : undefined;

  tx.db.referenceSerial += 1;
  const reservation = tx.create('reservations', 'res', {
    reference: `PL-${4800 + tx.db.referenceSerial}`,
    propertyId: input.propertyId,
    residentId: input.residentId,
    bookedFor: input.bookedFor,
    guest: input.guest
      ? {
          name: input.guest.name.trim(),
          phone: input.guest.phone?.trim() || undefined,
          email: input.guest.email?.trim() || undefined,
        }
      : undefined,
    vehiclePlate: normalisePlate(input.vehiclePlate),
    vehicleId: input.vehicleId,
    parkingType: input.parkingType,
    spaceId: space.id,
    status: 'confirmed',
    scheduledStart: iso(input.start),
    scheduledEnd: iso(input.end),
    invitationId: '',
    credentialId: '',
  });

  const invitation = tx.create('invitations', 'inv', {
    reservationId: reservation.id,
    inviteToken: newToken('inv'),
  });
  reservation.invitationId = invitation.id;
  reservation.credentialId = issueCredential(tx, reservation.id).id;

  if (connector && input.charging) {
    const allocation = tx.create('allocations', 'alc', {
      reservationId: reservation.id,
      chargerId: connector.chargerId,
      connectorId: connector.id,
      start: iso(input.charging.start),
      end: iso(input.charging.end),
      status: 'active',
      targetKwh: input.charging.targetKwh,
      targetPercent: input.charging.targetPercent,
    });
    reservation.chargingAllocationId = allocation.id;
    tx.create('chargingSessions', 'chs', {
      allocationId: allocation.id,
      reservationId: reservation.id,
      state: 'reserved',
      energyKwh: 0,
      rateKw: 0,
    });
  }

  tx.audit(actor, 'reservation.created', 'reservation', reservation.id, `${space.label}, ${reservation.reference}`);
  return reservation;
}

function assertVersion(r: Reservation, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && r.version !== expectedVersion) {
    throw new ParkingError(
      'stale',
      'This booking changed since you opened it. Review the latest details and try again.',
    );
  }
}

export interface ReservationEdit {
  start?: number;
  end?: number;
  spaceId?: string;
  guest?: GuestDetails;
  vehiclePlate?: string;
  charging?: ChargingRequest;
}

/**
 * Applies an edit only if the new time and bay can be secured. Otherwise
 * throws, and the transaction leaves the original booking untouched.
 */
export function editReservation(tx: Tx, id: string, edit: ReservationEdit, expectedVersion?: number): Reservation {
  const r = tx.get('reservations', id);
  assertVersion(r, expectedVersion);
  if (r.status !== 'confirmed') {
    throw new ParkingError('not-editable', 'Only upcoming bookings can be edited.');
  }
  const allocation = tx.find('allocations', r.chargingAllocationId);
  const connector = tx.find('connectors', allocation?.connectorId);

  const input: ReservationInput = {
    propertyId: r.propertyId,
    residentId: r.residentId,
    bookedFor: r.bookedFor,
    guest: edit.guest ?? r.guest,
    vehiclePlate: edit.vehiclePlate ?? r.vehiclePlate,
    vehicleId: r.vehicleId,
    parkingType: r.parkingType,
    start: edit.start ?? ms(r.scheduledStart),
    end: edit.end ?? ms(r.scheduledEnd),
    spaceId: edit.spaceId ?? r.spaceId,
    charging:
      edit.charging ??
      (allocation && connector
        ? {
            connectorType: connector.type,
            start: ms(allocation.start),
            end: ms(allocation.end),
            targetKwh: allocation.targetKwh,
            targetPercent: allocation.targetPercent,
          }
        : undefined),
  };
  // An unchanged arrival may already be under way; a moved one may not be in the past.
  if (
    input.start !== ms(r.scheduledStart) &&
    input.start < tx.now - tx.policy.startTolerancePastMinutes * MINUTE_MS
  ) {
    throw new ParkingError('in-past', 'The new arrival time has already passed.');
  }
  validateRequest(tx.db, input, tx.now, r.id);
  const space = assertBayFree(tx, input.spaceId, input.start, input.end, r.id);
  const nextConnector = input.charging ? pickConnector(tx, space.id, input.charging, r.id) : undefined;

  r.scheduledStart = iso(input.start);
  r.scheduledEnd = iso(input.end);
  r.effectiveStart = undefined;
  r.spaceId = space.id;
  r.guest = input.guest;
  r.vehiclePlate = normalisePlate(input.vehiclePlate);
  r.needsReassignment = undefined;
  tx.touch(r);

  if (allocation && nextConnector && input.charging) {
    allocation.connectorId = nextConnector.id;
    allocation.chargerId = nextConnector.chargerId;
    allocation.start = iso(input.charging.start);
    allocation.end = iso(input.charging.end);
    allocation.targetKwh = input.charging.targetKwh;
    allocation.targetPercent = input.charging.targetPercent;
    tx.touch(allocation);
  }
  tx.audit('resident', 'reservation.edited', 'reservation', r.id, `${space.label}, ${formatTime(input.start)}–${formatTime(input.end)}`);
  return r;
}

/** Moves the departure later, if the bay, limits and later bookings allow it. */
export function extendReservation(tx: Tx, id: string, newEnd: number, expectedVersion?: number): Reservation {
  const r = tx.get('reservations', id);
  assertVersion(r, expectedVersion);
  if (r.status !== 'confirmed' && r.status !== 'checked-in') {
    throw new ParkingError('not-extendable', 'Only upcoming or active visits can be extended.');
  }
  if (r.bayVacatedAt) {
    throw new ParkingError('not-extendable', 'The vehicle has already left its bay.');
  }
  const currentEnd = ms(r.scheduledEnd);
  if (newEnd <= currentEnd) {
    throw new ParkingError('invalid-time', 'Choose a departure later than the current one.');
  }
  if (newEnd <= tx.now) {
    throw new ParkingError('in-past', 'The new departure has already passed.');
  }
  const start = ms(r.scheduledStart);
  const maxMinutes =
    r.parkingType === 'ev' ? tx.policy.maxEvParkingDurationMinutes : tx.policy.maxStandardDurationMinutes;
  if ((newEnd - start) / MINUTE_MS > maxMinutes) {
    throw new ParkingError('too-long', `A stay can be at most ${maxMinutes / 60} hours in total.`);
  }
  const space = tx.get('spaces', r.spaceId);
  if (space.serviceability !== 'in-service') {
    throw new ParkingError('space-unavailable', `${space.label} is not in service, so it cannot be extended.`);
  }
  // The visit's own hold is excluded; anything booked after it is not.
  const extension = { start: currentEnd, end: newEnd + tx.policy.turnoverBufferMinutes * MINUTE_MS };
  for (const other of tx.db.reservations) {
    if (other.id === r.id || other.spaceId !== r.spaceId) continue;
    if (other.status !== 'confirmed' && other.status !== 'checked-in') continue;
    if (overlaps({ start: blockStart(other), end: ms(other.scheduledEnd) }, extension)) {
      throw new ParkingError(
        'extension-conflict',
        `${space.label} is booked from ${formatTime(blockStart(other))}. The visit keeps its current departure.`,
      );
    }
  }
  if (r.bookedFor === 'guest') {
    const peak = guestPeak(tx.db, r.propertyId, { start: currentEnd, end: newEnd }, tx.now, r.id);
    if (peak >= tx.policy.maxSimultaneousGuestBookingsPerProperty) {
      throw new ParkingError('guest-limit', 'The property’s guest limit would be exceeded by this extension.');
    }
  }
  const previous = r.scheduledEnd;
  r.scheduledEnd = iso(newEnd);
  r.overdueNotifiedAt = undefined;
  tx.touch(r);
  // A longer stay also moves an EV's move-out deadline (see charging.ts).
  const charging = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (charging?.moveOutOverstayAt) {
    charging.moveOutOverstayAt = undefined;
    tx.touch(charging);
  }
  tx.audit('resident', 'reservation.extended', 'reservation', r.id, `${previous} → ${r.scheduledEnd}`);
  return r;
}

function revokeCredential(tx: Tx, credentialId: string, reason: string) {
  const credential = tx.find('credentials', credentialId);
  if (credential && credential.status === 'active') {
    credential.status = 'revoked';
    credential.revokedAt = tx.nowIso;
    credential.revokeReason = reason;
    tx.touch(credential);
  }
}

function releaseAllocation(tx: Tx, allocation: ChargingAllocation | undefined, status: 'released' | 'cancelled') {
  if (!allocation || allocation.status !== 'active') {
    return;
  }
  allocation.status = status;
  if (status === 'released' && tx.now < Date.parse(allocation.end)) {
    allocation.end = tx.nowIso;
  }
  tx.touch(allocation);
}
export { releaseAllocation, revokeCredential };

export function cancelReservation(tx: Tx, id: string, actor: AuditActor = 'resident', reason?: string): Reservation {
  const r = tx.get('reservations', id);
  if (r.status === 'checked-in') {
    throw new ParkingError(
      'checked-in',
      'The visitor is already inside. The visit ends when they exit, or when security records a resolution.',
    );
  }
  if (r.status !== 'confirmed') {
    throw new ParkingError('not-cancellable', 'This booking is no longer upcoming.');
  }
  r.status = 'cancelled';
  r.cancelledAt = tx.nowIso;
  r.needsReassignment = undefined;
  tx.touch(r);
  revokeCredential(tx, r.credentialId, 'cancelled');
  releaseAllocation(tx, tx.find('allocations', r.chargingAllocationId), 'cancelled');
  const session = tx.db.chargingSessions.find((s) => s.reservationId === r.id);
  if (session && session.state === 'reserved') {
    session.endReason = 'Booking cancelled';
    tx.touch(session);
  }
  tx.audit(actor, 'reservation.cancelled', 'reservation', r.id, r.reference, reason);
  return r;
}

/** Issues a new QR before entry; the old one stops working immediately. */
export function replacePass(tx: Tx, id: string): Reservation {
  const r = tx.get('reservations', id);
  if (r.status !== 'confirmed') {
    throw new ParkingError('not-replaceable', 'A pass can only be replaced before the visitor enters.');
  }
  revokeCredential(tx, r.credentialId, 'replaced');
  r.credentialId = issueCredential(tx, r.id).id;
  tx.touch(r);
  tx.audit('resident', 'pass.replaced', 'reservation', r.id, r.reference);
  return r;
}

export function setVehiclePlate(tx: Tx, id: string, plate: string, actor: AuditActor): Reservation {
  const r = tx.get('reservations', id);
  if (r.status !== 'confirmed') {
    throw new ParkingError('not-editable', 'Vehicle details can only be changed before arrival.');
  }
  const normalised = normalisePlate(plate);
  if (!normalised) {
    throw new ParkingError('invalid-plate', 'Enter the vehicle’s plate number.');
  }
  assertPlate(normalised);
  r.vehiclePlate = normalised;
  tx.touch(r);
  tx.audit(actor, 'reservation.vehicle-updated', 'reservation', r.id, normalised);
  return r;
}

/**
 * Moves an upcoming booking to another bay (the nearest free one unless
 * `spaceId` names it), holding a compatible charger for EV bookings. Either
 * both move or neither does.
 */
export function reassignSpace(tx: Tx, id: string, actor: AuditActor, spaceId?: string): Reservation {
  const r = tx.get('reservations', id);
  if (r.status !== 'confirmed') {
    throw new ParkingError('not-reassignable', 'Only upcoming bookings can be moved to another bay.');
  }
  const allocation = tx.find('allocations', r.chargingAllocationId);
  const connector = tx.find('connectors', allocation?.connectorId);
  const start = ms(r.scheduledStart);
  const end = ms(r.scheduledEnd);
  const options = searchSpaces(
    tx.db,
    {
      propertyId: r.propertyId,
      kind: r.parkingType === 'ev' ? 'ev' : 'visitor',
      start,
      end,
      connectorType: connector?.type,
      chargingStart: allocation ? ms(allocation.start) : undefined,
      chargingEnd: allocation ? ms(allocation.end) : undefined,
      excludeReservationId: r.id,
    },
    tx.now,
  ).filter((o) => o.available && (spaceId ? o.space.id === spaceId : o.space.id !== r.spaceId));

  const choice = options[0];
  if (!choice) {
    throw new ParkingError(
      'no-alternative',
      'No other suitable bay is free for that whole time. The booking stays as it is.',
    );
  }
  const previous = tx.get('spaces', r.spaceId).label;
  r.spaceId = choice.space.id;
  r.needsReassignment = undefined;
  tx.touch(r);
  if (allocation && choice.connectorId) {
    const next = tx.get('connectors', choice.connectorId);
    allocation.connectorId = next.id;
    allocation.chargerId = next.chargerId;
    tx.touch(allocation);
    const session = tx.db.chargingSessions.find((s) => s.allocationId === allocation.id);
    if (session && session.state === 'reserved') {
      session.endReason = undefined;
      tx.touch(session);
    }
  }
  tx.notify({
    audience: 'owner',
    residentId: r.residentId,
    reservationId: r.id,
    kind: 'reassignment-needed',
    title: `Bay changed to ${choice.space.label}`,
    body: `${r.guest?.name ?? 'Your'} booking ${r.reference} moved from ${previous} to ${choice.space.label}. The pass and directions are updated.`,
  });
  tx.audit(actor, 'reservation.reassigned', 'reservation', r.id, `${previous} → ${choice.space.label}`);
  return r;
}

/** Visitor-side requests from the pass: they reach the operator's console. */
export function requestHelp(tx: Tx, id: string, kind: 'space-occupied' | 'contact', message?: string) {
  const r = tx.get('reservations', id);
  const space = tx.get('spaces', r.spaceId);
  tx.notify({
    audience: 'operator',
    reservationId: r.id,
    kind: 'help-request',
    title: kind === 'space-occupied' ? `Bay ${space.label} reported occupied` : `Visitor asked for help`,
    body: `${r.guest?.name ?? 'Driver'} (${r.reference})${message ? `: ${message}` : ''}`,
  });
  tx.audit('visitor', `help.${kind}`, 'reservation', r.id, space.label, message);
}

/** Marks an upcoming booking as needing another bay and tells the owner and security once. */
export function flagForReassignment(tx: Tx, r: Reservation, reason: string) {
  if (r.needsReassignment) {
    return;
  }
  r.needsReassignment = { reason, flaggedAt: tx.nowIso };
  tx.touch(r);
  tx.notify({
    audience: 'operator',
    reservationId: r.id,
    kind: 'reassignment-needed',
    title: `${r.reference} needs another bay`,
    body: reason,
  });
  tx.notify({
    audience: 'owner',
    residentId: r.residentId,
    reservationId: r.id,
    kind: 'reassignment-needed',
    title: 'Booking needs a new bay',
    body: `${r.guest?.name ? `${r.guest.name}'s` : 'Your'} booking ${r.reference}: ${reason}`,
  });
}
