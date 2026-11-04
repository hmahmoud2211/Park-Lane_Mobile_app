/**
 * Operator and demo actions on the site itself: bay occupancy, bay
 * serviceability and the exception queue. Each one is logged with who did it
 * and why.
 */
import { ParkingError, type Tx } from './tx';
import type { AuditActor, NotificationAudience, OccupancyState, Serviceability } from './types';

/**
 * Corrects or simulates a bay's physical state. Marking a bay vacant while a
 * checked-in visit holds it records that the car left the bay (the visit
 * itself stays open until the gate exit). Marking it occupied with no
 * session is an unexplained car, which blocks new bookings until resolved.
 */
export function setOccupancy(tx: Tx, spaceId: string, to: OccupancyState, actor: AuditActor, note: string) {
  const space = tx.get('spaces', spaceId);
  if (actor === 'operator' && note.trim().length < 3) {
    throw new ParkingError('reason-required', 'Record a short reason for this correction.');
  }
  if (space.occupancy === to) {
    return;
  }
  const holder = tx.find('reservations', space.occupiedByReservationId);
  tx.create('occupancyEvents', 'occ', {
    at: tx.nowIso,
    spaceId: space.id,
    from: space.occupancy,
    to,
    source: actor === 'operator' ? 'operator' : 'demo',
    reservationId: holder?.id,
    note,
  });
  if (to === 'vacant' && holder && holder.status === 'checked-in' && !holder.bayVacatedAt) {
    holder.bayVacatedAt = tx.nowIso;
    tx.touch(holder);
  }
  space.occupancy = to;
  space.occupancySince = tx.nowIso;
  if (to === 'vacant') {
    space.occupiedByReservationId = undefined;
  }
  tx.touch(space);
  tx.audit(actor, `bay.${to}`, 'space', space.id, space.label, note);
}

export function setServiceability(tx: Tx, spaceId: string, to: Serviceability, actor: AuditActor, note: string) {
  const space = tx.get('spaces', spaceId);
  if (space.serviceability === to) {
    return;
  }
  space.serviceability = to;
  tx.touch(space);
  tx.audit(actor, `bay.${to}`, 'space', space.id, space.label, note);
}

export function resolveNotification(tx: Tx, notificationId: string, actor: AuditActor, note: string) {
  const n = tx.get('notifications', notificationId);
  if (n.resolvedAt) {
    return;
  }
  n.resolvedAt = tx.nowIso;
  tx.touch(n);
  tx.audit(actor, 'exception.resolved', 'notification', n.id, n.title, note);
}

export function markRead(tx: Tx, audience: NotificationAudience, residentId?: string) {
  for (const n of tx.db.notifications) {
    if (n.audience === audience && !n.readAt && (!residentId || n.residentId === residentId)) {
      n.readAt = tx.nowIso;
      tx.touch(n);
    }
  }
}
