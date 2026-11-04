/**
 * Read models for the screens. Every count and status is derived from the
 * stored records at a clock reading; nothing here is a stored counter, so
 * the dashboard, lists and passes can never disagree.
 */
import { chargerFreeNow, isAvailableNow, isOverdue } from './availability';
import { projectSession, type SessionProjection } from './charging';
import { siteInfo } from './policy';
import { formatDateTime, formatRange, ms } from './time';
import type {
  AppNotification,
  Charger,
  ChargingAllocation,
  ChargingSession,
  Connector,
  Gate,
  GuestInvitation,
  NotificationAudience,
  ParkingDb,
  ParkingSpace,
  ParkingZone,
  Property,
  QrCredential,
  Reservation,
  Building,
  Vehicle,
} from './types';

/* ------------------------------------------------------------ Dashboard */

export interface DashboardCounts {
  /** Visitor and EV bays: the ones residents can book. */
  sharedTotal: number;
  sharedAvailableNow: number;
  guestTotal: number;
  guestAvailableNow: number;
  evBayTotal: number;
  evBayAvailableNow: number;
  chargerTotal: number;
  chargerFreeNow: number;
  chargerFaulted: number;
  /** Every bay in the compound, residents' own included. */
  allTotal: number;
  occupiedNow: number;
  unknownNow: number;
  notInService: number;
  occupancyRate: number;
}

export function dashboardCounts(db: ParkingDb, now: number): DashboardCounts {
  const shared = db.spaces.filter((s) => s.kind !== 'resident');
  const guest = shared.filter((s) => s.kind === 'visitor');
  const ev = shared.filter((s) => s.kind === 'ev');
  const occupied = db.spaces.filter((s) => s.occupancy === 'occupied').length;
  return {
    sharedTotal: shared.length,
    sharedAvailableNow: shared.filter((s) => isAvailableNow(db, s, now)).length,
    guestTotal: guest.length,
    guestAvailableNow: guest.filter((s) => isAvailableNow(db, s, now)).length,
    evBayTotal: ev.length,
    evBayAvailableNow: ev.filter((s) => isAvailableNow(db, s, now)).length,
    chargerTotal: db.chargers.length,
    chargerFreeNow: db.chargers.filter((c) => chargerFreeNow(db, c, now)).length,
    chargerFaulted: db.chargers.filter((c) => c.status !== 'available').length,
    allTotal: db.spaces.length,
    occupiedNow: occupied,
    unknownNow: db.spaces.filter((s) => s.occupancy === 'unknown').length,
    notInService: db.spaces.filter((s) => s.serviceability !== 'in-service').length,
    occupancyRate: db.spaces.length ? occupied / db.spaces.length : 0,
  };
}

/* ---------------------------------------------------------- Reservation */

export type DisplayStatusKey =
  | 'action-needed'
  | 'confirmed'
  | 'checked-in'
  | 'overdue'
  | 'completed'
  | 'cancelled'
  | 'no-show';

export type DisplayTone = 'teal' | 'violet' | 'slate' | 'indigo' | 'amber' | 'red';

export interface DisplayStatus {
  key: DisplayStatusKey;
  label: string;
  tone: DisplayTone;
}

export function displayStatus(r: Reservation, now: number): DisplayStatus {
  switch (r.status) {
    case 'confirmed':
      return r.needsReassignment
        ? { key: 'action-needed', label: 'Action needed', tone: 'amber' }
        : { key: 'confirmed', label: 'Confirmed', tone: 'violet' };
    case 'checked-in':
      return isOverdue(r, now)
        ? { key: 'overdue', label: 'Overdue', tone: 'red' }
        : { key: 'checked-in', label: 'Checked in', tone: 'teal' };
    case 'completed':
      return { key: 'completed', label: 'Completed', tone: 'slate' };
    case 'cancelled':
      return { key: 'cancelled', label: 'Cancelled', tone: 'slate' };
    case 'no-show':
      return { key: 'no-show', label: 'No-show', tone: 'amber' };
  }
}

export interface ReservationView {
  reservation: Reservation;
  status: DisplayStatus;
  /** Who the booking is for, as people say it. */
  title: string;
  property: Property;
  space: ParkingSpace;
  zone: ParkingZone;
  gate: Gate;
  building: Building | undefined;
  vehicle?: Vehicle;
  invitation?: GuestInvitation;
  credential?: QrCredential;
  allocation?: ChargingAllocation;
  connector?: Connector;
  charger?: Charger;
  charging?: ChargingSession;
  chargingProjection?: SessionProjection;
  overdue: boolean;
}

export function reservationView(db: ParkingDb, r: Reservation, now: number): ReservationView {
  const space = db.spaces.find((s) => s.id === r.spaceId)!;
  const allocation = db.allocations.find((a) => a.id === r.chargingAllocationId);
  const connector = db.connectors.find((c) => c.id === allocation?.connectorId);
  const charging = db.chargingSessions.find((s) => s.reservationId === r.id);
  const vehicle = db.vehicles.find((v) => v.id === r.vehicleId);
  return {
    reservation: r,
    status: displayStatus(r, now),
    title: r.guest?.name ?? (vehicle ? `My ${vehicle.make} ${vehicle.model}` : 'My vehicle'),
    property: db.properties.find((p) => p.id === r.propertyId)!,
    space,
    zone: db.zones.find((z) => z.id === space.zoneId)!,
    gate: db.gates.find((g) => g.id === space.gateId)!,
    building: db.buildings.find((b) => b.id === space.buildingId),
    vehicle,
    invitation: db.invitations.find((i) => i.id === r.invitationId),
    credential: db.credentials.find((c) => c.id === r.credentialId),
    allocation,
    connector,
    charger: db.chargers.find((c) => c.id === allocation?.chargerId),
    charging,
    chargingProjection: charging ? projectSession(db, charging, now) : undefined,
    overdue: isOverdue(r, now),
  };
}

export function findReservation(db: ParkingDb, id: string | undefined) {
  return db.reservations.find((r) => r.id === id);
}

/** Newest-relevant first: active, then upcoming by start, then history. */
export function residentReservations(db: ParkingDb, residentId: string): Reservation[] {
  const rank = (r: Reservation) =>
    r.status === 'checked-in' ? 0 : r.status === 'confirmed' ? 1 : 2;
  return db.reservations
    .filter((r) => r.residentId === residentId)
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return rank(a) === 2
        ? ms(b.scheduledStart) - ms(a.scheduledStart)
        : ms(a.scheduledStart) - ms(b.scheduledStart);
    });
}

export function findInvitation(db: ParkingDb, inviteToken: string | undefined) {
  if (!inviteToken) return undefined;
  const invitation = db.invitations.find((i) => i.inviteToken === inviteToken && !i.revokedAt);
  const reservation = invitation ? findReservation(db, invitation.reservationId) : undefined;
  return invitation && reservation ? { invitation, reservation } : undefined;
}

export function notificationsFor(
  db: ParkingDb,
  audience: NotificationAudience,
  filter?: { residentId?: string; reservationId?: string },
): AppNotification[] {
  return db.notifications
    .filter(
      (n) =>
        n.audience === audience &&
        (!filter?.residentId || n.residentId === filter.residentId) &&
        (!filter?.reservationId || n.reservationId === filter.reservationId),
    )
    .sort((a, b) => ms(b.at) - ms(a.at));
}

/** The resident's own car and bay, for "My Parking". */
export function myParking(db: ParkingDb, residentId: string) {
  const propertyIds = db.associations.filter((a) => a.residentId === residentId).map((a) => a.propertyId);
  const properties = db.properties.filter((p) => propertyIds.includes(p.id));
  const home = properties.find((p) => p.assignedSpaceId) ?? properties[0];
  const space = db.spaces.find((s) => s.id === home?.assignedSpaceId);
  return {
    properties,
    home,
    space,
    zone: db.zones.find((z) => z.id === space?.zoneId),
    building: db.buildings.find((b) => b.id === home?.buildingId),
    vehicles: db.vehicles.filter((v) => v.residentId === residentId),
  };
}

/* ------------------------------------------------------------ Activity */

export interface ActivityItem {
  id: string;
  at: string;
  kind: 'entry' | 'exit' | 'booked' | 'cancelled' | 'no-show';
  title: string;
  detail: string;
  /** When it happened, worded so a booking's creation is not read as its visit time. */
  timeLabel: string;
}

/** Gate and booking events for the resident's own bookings, newest first. */
export function residentActivity(db: ParkingDb, residentId: string, limit = 6): ActivityItem[] {
  const mine = new Map(db.reservations.filter((r) => r.residentId === residentId).map((r) => [r.id, r]));
  const items: ActivityItem[] = [];
  for (const e of db.scanEvents) {
    const r = e.reservationId ? mine.get(e.reservationId) : undefined;
    if (!r || e.outcome !== 'accepted') continue;
    const space = db.spaces.find((s) => s.id === r.spaceId);
    items.push({
      id: e.id,
      at: e.at,
      kind: e.direction,
      title: e.direction === 'entry' ? 'Car entered' : 'Car left',
      detail: `${r.guest?.name ?? 'My vehicle'} · ${space?.label ?? ''}`,
      timeLabel: formatDateTime(e.at),
    });
  }
  for (const a of db.audit) {
    const r = mine.get(a.entityId);
    if (!r) continue;
    const booked = r.parkingType === 'ev' ? 'EV charging booked' : 'Guest parking booked';
    const label: Partial<Record<string, [ActivityItem['kind'], string, string]>> = {
      'reservation.created': ['booked', booked, 'Booked'],
      'reservation.cancelled': ['cancelled', 'Booking cancelled', 'Cancelled'],
      'reservation.no-show': ['no-show', 'Guest did not arrive', 'Expired'],
    };
    const match = label[a.action];
    if (!match) continue;
    const space = db.spaces.find((s) => s.id === r.spaceId);
    items.push({
      id: a.id,
      at: a.at,
      kind: match[0],
      title: match[1],
      detail: `${r.guest?.name ?? 'My vehicle'} · ${space?.label ?? ''} · ${formatRange(r.scheduledStart, r.scheduledEnd)}`,
      timeLabel: `${match[2]} ${formatDateTime(a.at)}`,
    });
  }
  return items.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, limit);
}

/* ---------------------------------------------------------- Directions */

/** External maps link to the vehicle entrance, never to an indoor bay. */
export function gateMapsUrl(gate: Gate): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${gate.geo.lat},${gate.geo.lng}&travelmode=driving`;
}

export function directionsText(view: ReservationView, inviteUrl?: string): string {
  const { space, zone, gate } = view;
  return [
    `${siteInfo.compoundName}: parking for ${view.title}`,
    `Space ${space.label}, ${zone.name} (${zone.level})`,
    `Use ${gate.name}: ${gateMapsUrl(gate)}`,
    space.instructions,
    inviteUrl ? `Your pass: ${inviteUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function inviteUrl(origin: string, invitation: GuestInvitation): string {
  return `${origin.replace(/\/+$/, '')}/pass/${invitation.inviteToken}`;
}
