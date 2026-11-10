import { call, EmsError } from '../../ems/services/emsHttp';
import { searchSpaces, type SearchRequest } from './availability';
import type { ReservationEdit, ReservationInput } from './reservations';
import type { ParkingService } from './service';
import type { ShareChannel } from './tracking';
import { ParkingError } from './tx';
import type { AuditActor, ParkingDb } from './types';

/**
 * Parking on the EMS backend (backend/src/routes/parking.ts), behind the same methods as the on-device demo's
 * ParkingService, so the screens work unchanged. The rules run on the server inside one transaction; each call
 * returns the record it changed, then the snapshot is fetched again. Search runs here over the snapshot (which
 * holds other apartments' bookings as bay and time only); booking checks again on the server.
 */

/** What screens may call; the demo service and this one both provide it. */
export type ParkingActions = Omit<ParkingService, 'repo'>;

/** The snapshot as the backend sends it: the store for one apartment, plus who is asking. */
export type RemoteSnapshot = ParkingDb & {
  me: { residentId: string; propertyId: string };
  inviteBase: string;
  securityPhone: string | null;
  serverNow: string;
};

/** Turns the backend's refusals back into the rules' own errors, which the screens show and branch on. */
async function parking<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof EmsError) {
      throw new ParkingError(error.code === 'parking_refused' && error.field ? error.field : error.code, error.message);
    }
    throw error;
  }
}

const post = <T>(path: string, body: unknown = {}) => parking(call<T>(path, { method: 'POST', body }));

const notHere = () => Promise.reject(new ParkingError('not-available', 'Gate and demo actions are on the building management dashboard.'));

export class RemoteParkingService implements ParkingActions {
  private readonly snapshot: () => ParkingDb | null;
  private readonly refresh: () => Promise<void>;

  constructor(snapshot: () => ParkingDb | null, refresh: () => Promise<void>) {
    this.snapshot = snapshot;
    this.refresh = refresh;
  }

  now() {
    return Date.now();
  }

  /** Over the snapshot: free bays now, without a round trip; the booking itself is checked again on the server. */
  search(request: SearchRequest) {
    const db = this.snapshot();
    return db ? searchSpaces(db, request, Date.now()) : [];
  }

  private async then<T>(promise: Promise<T>): Promise<T> {
    const result = await promise;
    await this.refresh().catch(() => undefined);
    return result;
  }

  private booking<T>(id: string, action: string, body: unknown = {}) {
    return this.then(post<T>(`/api/parking/reservations/${encodeURIComponent(id)}/${action}`, body));
  }

  private pass<T>(invite: string, action: string, body: unknown = {}) {
    return this.then(post<T>(`/api/parking/pass/${encodeURIComponent(invite)}/${action}`, body));
  }

  createReservation(input: ReservationInput) {
    return this.then(post<Awaited<ReturnType<ParkingActions['createReservation']>>>('/api/parking/reservations', input));
  }
  editReservation(id: string, edit: ReservationEdit, expectedVersion?: number) {
    return this.booking<Awaited<ReturnType<ParkingActions['editReservation']>>>(id, 'edit', { edit, expectedVersion });
  }
  extendReservation(id: string, newEnd: number, expectedVersion?: number) {
    return this.booking<Awaited<ReturnType<ParkingActions['extendReservation']>>>(id, 'extend', { end: newEnd, expectedVersion });
  }
  cancelReservation(id: string) {
    return this.booking<Awaited<ReturnType<ParkingActions['cancelReservation']>>>(id, 'cancel');
  }
  replacePass(id: string) {
    return this.booking<Awaited<ReturnType<ParkingActions['replacePass']>>>(id, 'replace-pass');
  }
  reassign(id: string, _actor: AuditActor, spaceId?: string) {
    return this.booking<Awaited<ReturnType<ParkingActions['reassign']>>>(id, 'reassign', { spaceId });
  }
  recordShare(id: string, channel: ShareChannel) {
    return this.booking<void>(id, 'share', { channel }).then(() => undefined);
  }
  plugIn(reservationId: string) {
    return this.booking<Awaited<ReturnType<ParkingActions['plugIn']>>>(reservationId, 'plug-in');
  }
  stopCharging(reservationId: string) {
    return this.booking<Awaited<ReturnType<ParkingActions['stopCharging']>>>(reservationId, 'stop');
  }
  markRead() {
    return this.then(post<void>('/api/parking/notifications/read')).then(() => undefined);
  }

  /* The visitor's pass, by its link */
  addVehicleFromPass(inviteToken: string, plate: string) {
    return this.pass<Awaited<ReturnType<ParkingActions['addVehicleFromPass']>>>(inviteToken, 'plate', { plate });
  }
  requestHelp(inviteToken: string, kind: 'space-occupied' | 'contact', message?: string) {
    return this.pass<Awaited<ReturnType<ParkingActions['requestHelp']>>>(inviteToken, 'help', { kind, message });
  }
  plugInFromPass(inviteToken: string) {
    return this.pass<Awaited<ReturnType<ParkingActions['plugInFromPass']>>>(inviteToken, 'plug-in');
  }
  stopChargingFromPass(inviteToken: string) {
    return this.pass<Awaited<ReturnType<ParkingActions['stopChargingFromPass']>>>(inviteToken, 'stop');
  }

  tick() {
    return this.refresh();
  }

  /* Gate staff and the demo's simulations live elsewhere (the dashboard; the offline demo). */
  scan = notHere;
  operatorEntry = notHere;
  operatorExit = notHere;
  markMovedOut = notHere;
  setOccupancy = notHere;
  setServiceability = notHere;
  resolveNotification = notHere;
  simulateChargingComplete = notHere;
  faultCharger = notHere;
  restoreCharger = notHere;
  advanceClock = notHere;
  resetDemo = notHere;
}

export const getParkingSnapshot = () => call<RemoteSnapshot>('/api/parking/snapshot', { retry: true });
