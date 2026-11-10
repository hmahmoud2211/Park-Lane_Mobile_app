import { publishToSite } from '../ems/broadcast.ts';
import { notify } from '../ems/notifications.ts';
import { findParkingSite, staffUserIds } from '../repositories/parking.ts';
import { findUserById } from '../repositories/users.ts';
import { searchSpaces, type SearchRequest } from './engine/availability.ts';
import { faultCharger, markMovedOut, plugIn, restoreCharger, stopChargingInTx } from './engine/charging.ts';
import { operatorEntry, operatorExit, scanPass } from './engine/gate.ts';
import { markRead, resolveNotification, setOccupancy, setServiceability } from './engine/operations.ts';
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
} from './engine/reservations.ts';
import { findInvitation } from './engine/selectors.ts';
import { ParkingError, type Tx } from './engine/tx.ts';
import type { AuditActor, NotificationAudience, OccupancyState, ParkingDb, ScanDirection, Serviceability } from './engine/types.ts';
import { loadParkingDb, runParking, type ParkingOutcome } from './store.ts';

/**
 * The parking operations, as the app's ParkingService had them, for one compound. Each is one atomic step
 * (store.ts runParking). After a step commits, the alerts the rules raised go to the inbox (owners: the resident
 * who booked; operators: security and admins), and residents of the compound get `parking.updated`.
 */
export class ParkingService {
  readonly siteId: string;
  private readonly clock: () => number;

  constructor(siteId: string, clock: () => number = Date.now) {
    this.siteId = siteId;
    this.clock = clock;
  }

  now(): number {
    return this.clock();
  }

  /** Runs an operation and its follow-ups. */
  run<T>(operation: (tx: Tx) => T): T {
    const outcome = runParking(this.siteId, operation, this.clock());
    this.afterCommit(outcome);
    return outcome.result;
  }

  /** The whole store (management's views and tests). Residents get a scoped view (views.ts). */
  snapshot(): ParkingDb {
    return loadParkingDb(this.siteId, 'full', this.clock()).db;
  }

  /** Read-only search over committed data; booking checks again inside its step. */
  search(request: SearchRequest) {
    const now = this.clock();
    return searchSpaces(loadParkingDb(this.siteId, 'transaction', now).db, request, now);
  }

  /** The committed revision: it moves whenever a step changes something. */
  snapshotRevision(): number {
    return findParkingSite(this.siteId)?.revision ?? 0;
  }

  /** Applies due rules (no-shows, overdue visits, charging windows) with no other change. */
  tick(): void {
    this.run(() => undefined);
  }

  private afterCommit(outcome: ParkingOutcome<unknown>) {
    for (const item of outcome.notifications) {
      const recipients = item.audience === 'operator' ? staffUserIds() : item.audience === 'owner' && item.residentId && findUserById(item.residentId) ? [item.residentId] : [];
      if (recipients.length) notify(recipients, { kind: 'parking', title: item.title, body: item.body, ref: item.reservationId ? { type: 'parking_reservation', id: item.reservationId } : null }, item.at);
    }
    if (outcome.changed) publishToSite(this.siteId, { type: 'parking.updated' });
  }

  /* Residents */
  createReservation(input: ReservationInput, actor: AuditActor = 'resident', prepare?: (tx: Tx) => void) {
    return this.run((tx) => {
      prepare?.(tx);
      return createReservation(tx, input, actor);
    });
  }
  editReservation(id: string, edit: ReservationEdit, expectedVersion?: number) {
    return this.run((tx) => editReservation(tx, id, edit, expectedVersion));
  }
  extendReservation(id: string, newEnd: number, expectedVersion?: number) {
    return this.run((tx) => extendReservation(tx, id, newEnd, expectedVersion));
  }
  cancelReservation(id: string, actor: AuditActor = 'resident', reason?: string) {
    return this.run((tx) => cancelReservation(tx, id, actor, reason));
  }
  replacePass(id: string) {
    return this.run((tx) => replacePass(tx, id));
  }
  reassign(id: string, actor: AuditActor, spaceId?: string) {
    return this.run((tx) => reassignSpace(tx, id, actor, spaceId));
  }
  /** The owner handed the pass to WhatsApp or the share menu: "shared", which nothing can confirm was delivered. */
  recordShare(id: string, channel: string) {
    return this.run((tx) => {
      tx.get('reservations', id);
      tx.audit('resident', 'pass.shared', 'reservation', id, channel);
    });
  }
  plugIn(reservationId: string, actor: AuditActor = 'resident') {
    return this.run((tx) => plugIn(tx, reservationId, actor));
  }
  stopCharging(reservationId: string, actor: AuditActor = 'resident') {
    return this.run((tx) => stopChargingInTx(tx, reservationId, actor));
  }
  markRead(audience: NotificationAudience, residentId?: string) {
    return this.run((tx) => markRead(tx, audience, residentId));
  }

  /* Visitors, known only by their invitation link */
  private byInvite(tx: Tx, inviteToken: string) {
    const found = findInvitation(tx.db, inviteToken);
    if (!found) throw new ParkingError('invite-not-found', 'This invitation is not available.');
    return found.reservation;
  }
  addVehicleFromPass(inviteToken: string, plate: string) {
    return this.run((tx) => setVehiclePlate(tx, this.byInvite(tx, inviteToken).id, plate, 'visitor'));
  }
  requestHelp(inviteToken: string, kind: 'space-occupied' | 'contact', message?: string) {
    return this.run((tx) => requestHelp(tx, this.byInvite(tx, inviteToken).id, kind, message));
  }
  plugInFromPass(inviteToken: string) {
    return this.run((tx) => plugIn(tx, this.byInvite(tx, inviteToken).id, 'visitor'));
  }
  stopChargingFromPass(inviteToken: string) {
    return this.run((tx) => stopChargingInTx(tx, this.byInvite(tx, inviteToken).id, 'visitor'));
  }

  /* Security */
  scan(input: string, gateId: string, direction: ScanDirection) {
    return this.run((tx) => scanPass(tx, input, gateId, direction));
  }
  operatorEntry(reservationId: string, gateId: string, reason: string, plate?: string) {
    return this.run((tx) => operatorEntry(tx, reservationId, gateId, reason, plate));
  }
  operatorExit(reservationId: string, gateId: string, reason: string) {
    return this.run((tx) => operatorExit(tx, reservationId, gateId, reason));
  }
  markMovedOut(reservationId: string, actor: AuditActor, note?: string) {
    return this.run((tx) => markMovedOut(tx, reservationId, actor, note));
  }
  setOccupancy(spaceId: string, to: OccupancyState, actor: AuditActor, note: string) {
    return this.run((tx) => setOccupancy(tx, spaceId, to, actor, note));
  }
  setServiceability(spaceId: string, to: Serviceability, actor: AuditActor, note: string) {
    return this.run((tx) => setServiceability(tx, spaceId, to, actor, note));
  }
  resolveNotification(id: string, actor: AuditActor, note: string) {
    return this.run((tx) => resolveNotification(tx, id, actor, note));
  }
  faultCharger(chargerId: string, actor: AuditActor = 'operator') {
    return this.run((tx) => faultCharger(tx, chargerId, actor));
  }
  restoreCharger(chargerId: string, actor: AuditActor = 'operator') {
    return this.run((tx) => restoreCharger(tx, chargerId, actor));
  }
}
