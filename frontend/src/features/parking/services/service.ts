/**
 * The one entry point screens use. Each method is a single atomic
 * transaction on the repository; screens never change records themselves.
 *
 * To move to a real backend, keep these method signatures and make each one
 * an API call: the server runs the same rules inside a database transaction
 * and returns the updated records.
 */
import { searchSpaces, type SearchRequest } from './availability';
import {
  faultCharger,
  markMovedOut,
  plugIn,
  restoreCharger,
  simulateChargingComplete,
  stopChargingInTx,
} from './charging';
import { operatorEntry, operatorExit, scanPass } from './gate';
import { markRead, resolveNotification, setOccupancy, setServiceability } from './operations';
import type { ParkingRepository } from './repository';
import {
  cancelReservation,
  createReservation,
  editReservation,
  extendReservation,
  reassignSpace,
  replacePass,
  requestHelp,
  setVehiclePlate,
  type ReservationEdit,
  type ReservationInput,
} from './reservations';
import { findInvitation } from './selectors';
import type { ShareChannel } from './tracking';
import { ParkingError, type Tx } from './tx';
import type { AuditActor, NotificationAudience, OccupancyState, ScanDirection, Serviceability } from './types';

export class ParkingService {
  constructor(readonly repo: ParkingRepository) {}

  now() {
    return this.repo.now();
  }

  /** Read-only search over the committed data; booking re-checks inside its transaction. */
  search(request: SearchRequest) {
    return searchSpaces(this.repo.snapshot, request, this.repo.now());
  }

  /* Residents */
  createReservation(input: ReservationInput, actor: AuditActor = 'resident') {
    return this.repo.transact((tx) => createReservation(tx, input, actor));
  }
  editReservation(id: string, edit: ReservationEdit, expectedVersion?: number) {
    return this.repo.transact((tx) => editReservation(tx, id, edit, expectedVersion));
  }
  extendReservation(id: string, newEnd: number, expectedVersion?: number) {
    return this.repo.transact((tx) => extendReservation(tx, id, newEnd, expectedVersion));
  }
  cancelReservation(id: string) {
    return this.repo.transact((tx) => cancelReservation(tx, id, 'resident'));
  }
  replacePass(id: string) {
    return this.repo.transact((tx) => replacePass(tx, id));
  }
  reassign(id: string, actor: AuditActor, spaceId?: string) {
    return this.repo.transact((tx) => reassignSpace(tx, id, actor, spaceId));
  }
  /**
   * The owner handed the pass to WhatsApp or the share menu. Recorded
   * for the tracker as "shared": nothing here can confirm it was delivered.
   */
  recordShare(id: string, channel: ShareChannel) {
    return this.repo.transact((tx) => {
      tx.get('reservations', id);
      tx.audit('resident', 'pass.shared', 'reservation', id, channel);
    });
  }

  /* Visitors, identified only by their invitation link */
  private byInvite(tx: Tx, inviteToken: string) {
    const found = findInvitation(tx.db, inviteToken);
    if (!found) {
      throw new ParkingError('invite-not-found', 'This invitation is not available.');
    }
    return found.reservation;
  }
  addVehicleFromPass(inviteToken: string, plate: string) {
    return this.repo.transact((tx) => setVehiclePlate(tx, this.byInvite(tx, inviteToken).id, plate, 'visitor'));
  }
  requestHelp(inviteToken: string, kind: 'space-occupied' | 'contact', message?: string) {
    return this.repo.transact((tx) => requestHelp(tx, this.byInvite(tx, inviteToken).id, kind, message));
  }
  plugInFromPass(inviteToken: string) {
    return this.repo.transact((tx) => plugIn(tx, this.byInvite(tx, inviteToken).id, 'visitor'));
  }
  stopChargingFromPass(inviteToken: string) {
    return this.repo.transact((tx) => stopChargingInTx(tx, this.byInvite(tx, inviteToken).id, 'visitor'));
  }

  /* Charging, for the resident's own bookings */
  plugIn(reservationId: string, actor: AuditActor = 'resident') {
    return this.repo.transact((tx) => plugIn(tx, reservationId, actor));
  }
  stopCharging(reservationId: string, actor: AuditActor = 'resident') {
    return this.repo.transact((tx) => stopChargingInTx(tx, reservationId, actor));
  }

  /* Security */
  scan(input: string, gateId: string, direction: ScanDirection) {
    return this.repo.transact((tx) => scanPass(tx, input, gateId, direction));
  }
  operatorEntry(reservationId: string, gateId: string, reason: string, plate?: string) {
    return this.repo.transact((tx) => operatorEntry(tx, reservationId, gateId, reason, plate));
  }
  operatorExit(reservationId: string, gateId: string, reason: string) {
    return this.repo.transact((tx) => operatorExit(tx, reservationId, gateId, reason));
  }
  markMovedOut(reservationId: string, actor: AuditActor, note?: string) {
    return this.repo.transact((tx) => markMovedOut(tx, reservationId, actor, note));
  }
  setOccupancy(spaceId: string, to: OccupancyState, actor: AuditActor, note: string) {
    return this.repo.transact((tx) => setOccupancy(tx, spaceId, to, actor, note));
  }
  setServiceability(spaceId: string, to: Serviceability, actor: AuditActor, note: string) {
    return this.repo.transact((tx) => setServiceability(tx, spaceId, to, actor, note));
  }
  resolveNotification(id: string, actor: AuditActor, note: string) {
    return this.repo.transact((tx) => resolveNotification(tx, id, actor, note));
  }
  markRead(audience: NotificationAudience, residentId?: string) {
    return this.repo.transact((tx) => markRead(tx, audience, residentId));
  }

  /* Demo simulation */
  simulateChargingComplete(reservationId: string) {
    return this.repo.transact((tx) => simulateChargingComplete(tx, reservationId));
  }
  faultCharger(chargerId: string) {
    return this.repo.transact((tx) => faultCharger(tx, chargerId, 'demo'));
  }
  restoreCharger(chargerId: string) {
    return this.repo.transact((tx) => restoreCharger(tx, chargerId, 'demo'));
  }
  advanceClock(byMs: number) {
    return this.repo.advanceClock(byMs);
  }
  resetDemo() {
    return this.repo.reset();
  }
  tick() {
    return this.repo.tick();
  }
}
