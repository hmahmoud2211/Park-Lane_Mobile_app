import { parkingSiteIds } from '../repositories/parking.ts';
import { cancelReservation } from './engine/reservations.ts';
import { ParkingService } from './service.ts';
import { forgetResidentRows } from './store.ts';

/**
 * A resident deletes their account: the parking bookings they made that haven't started are cancelled through the
 * rules (so the pass and the visitor's link stop working, and the bay is free again); then store.ts
 * forgetResidentRows keeps the rest as the gate's log without them and removes their vehicles and alerts.
 */
export function forgetParkingResident(userId: string, nowMs = Date.now()): void {
  for (const siteId of parkingSiteIds()) {
    new ParkingService(siteId, () => nowMs).run((tx) => {
      for (const reservation of tx.db.reservations) {
        if (reservation.residentId === userId && reservation.status === 'confirmed') cancelReservation(tx, reservation.id, 'system', 'Account deleted');
      }
    });
  }
  forgetResidentRows(userId);
}

/** The minute sweep: due rules (no-shows, overdue visits, charging windows) on every compound with parking. */
export function sweepParking(nowMs = Date.now()): number {
  let changed = 0;
  for (const siteId of parkingSiteIds()) {
    const service = new ParkingService(siteId, () => nowMs);
    const before = service.snapshotRevision();
    service.tick();
    if (service.snapshotRevision() !== before) changed += 1;
  }
  return changed;
}
