import type { User } from '../ems/auth.ts';
import { unseal } from '../ems/secrets.ts';
import { siteSettings } from '../ems/sites.ts';
import { reservationRowsFor, rowsForReservations, rowsWhere, type StoredRow } from '../repositories/parking.ts';
import { findUnitDetails, memberIdsOfUnit, memberRole, type Unit } from '../repositories/units.ts';
import { findUserById } from '../repositories/users.ts';
import { credentialToken, invitationToken } from './engine/crypto.ts';
import type { Tx } from './engine/tx.ts';
import type {
  Building,
  ChargingAllocation,
  ChargingSession,
  Entity,
  ParkingDb,
  ParkingSpace,
  Property,
  PropertyAssociation,
  Reservation,
  Resident,
} from './engine/types.ts';
import { loadParkingDb } from './store.ts';

/**
 * Who the parking rules see, and what a resident may see of them.
 *
 * The rules know "residents" and "properties"; on the server these are the backend's users and units. Before a
 * resident's operation, `ensureIdentity` writes (or refreshes) their resident, property and association rows in the
 * same step. `residentSnapshot` is the store as one apartment may see it: the layout, its own bookings with their
 * passes (tokens re-created for it), and other apartments' open bookings reduced to the bay and the time they hold,
 * so the app can show what is free without learning who booked.
 */

const asOf = (at: string) => ({ createdAt: at, updatedAt: at, version: 1 });

/** The property the rules use for a unit: its building (by tower letter), its own bay, and that building's door. */
export function propertyFor(unit: Unit, buildings: readonly Building[], spaces: readonly ParkingSpace[], at: string): Property {
  const details = findUnitDetails(unit.id);
  const tower = (details?.tower ?? unit.building ?? '').trim().toLowerCase();
  const building =
    buildings.find((entry) => entry.id === `bld-${tower}` || entry.name.toLowerCase() === `building ${tower}` || entry.name.toLowerCase() === tower) ?? buildings[0];
  const bay = details?.parkingBay ? spaces.find((space) => space.kind === 'resident' && space.label.toLowerCase() === details.parkingBay!.trim().toLowerCase()) : undefined;
  return { id: unit.id, label: unit.name, buildingId: building.id, assignedSpaceId: bay?.id, mapEntrance: building.door, ...asOf(at) };
}

function upsert<T extends Entity>(list: T[], next: T, same: (current: T) => boolean, tx: Tx) {
  const current = list.find((item) => item.id === next.id);
  if (!current) {
    list.push(next);
  } else if (!same(current)) {
    Object.assign(current, { ...next, createdAt: current.createdAt, version: current.version });
    tx.touch(current);
  }
}

/** Makes the rules know the user, their unit and that they belong to it (inside the operation's step). */
export function ensureIdentity(tx: Tx, user: User, unit: Unit): void {
  const property = propertyFor(unit, tx.db.buildings, tx.db.spaces, tx.nowIso);
  upsert(tx.db.properties, property, (p) => p.label === property.label && p.buildingId === property.buildingId && p.assignedSpaceId === property.assignedSpaceId, tx);
  const resident: Resident = { id: user.id, name: user.name, phone: '', email: user.email, ...asOf(tx.nowIso) };
  upsert(tx.db.residents, resident, (r) => r.name === resident.name && r.email === resident.email, tx);
  const role = memberRole(user.id) === 'owner' ? 'owner' : 'tenant';
  const association: PropertyAssociation = { id: `asc-${unit.id}-${user.id}`, residentId: user.id, propertyId: unit.id, role, ...asOf(tx.nowIso) };
  upsert(tx.db.associations, association, (a) => a.role === role, tx);
}

// ---- the resident's view ------------------------------------------------------------------------------

const decode = <T>(row: StoredRow, sealed: boolean) => JSON.parse(sealed ? unseal(row.data) : row.data) as T;

/** Another apartment's booking, reduced to what availability needs. */
function anonymous(r: Reservation): Reservation {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: r.version,
    reference: '',
    propertyId: '',
    residentId: '',
    bookedFor: r.bookedFor,
    parkingType: r.parkingType,
    spaceId: r.spaceId,
    status: r.status,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    effectiveStart: r.effectiveStart,
    actualEntryAt: r.actualEntryAt,
    actualExitAt: r.actualExitAt,
    bayVacatedAt: r.bayVacatedAt,
    chargingAllocationId: r.chargingAllocationId,
    invitationId: '',
    credentialId: '',
  };
}

export interface ResidentSnapshot extends ParkingDb {
  me: { residentId: string; propertyId: string };
  /** Where the visitor's pass page lives: `${inviteBase}/<token>`. */
  inviteBase: string;
  /** The compound's security desk (Compound rules), or null while unset. */
  securityPhone: string | null;
  serverNow: string;
}

/** The store as one apartment may see it. Bookings from the last 90 days are its history. */
export function residentSnapshot(siteId: string, user: User, unit: Unit, base: string, nowMs = Date.now()): ResidentSnapshot {
  const at = new Date(nowMs).toISOString();
  const { db: live } = loadParkingDb(siteId, 'transaction', nowMs);
  const rows = reservationRowsFor(siteId, unit.id, new Date(nowMs - 90 * 86_400_000).toISOString()).map((row) => decode<Reservation>(row, true));
  const mineIds = new Set(rows.filter((r) => r.propertyId === unit.id).map((r) => r.id));
  const reservations = rows.map((r) => (mineIds.has(r.id) ? r : anonymous(r)));
  const ids = reservations.map((r) => r.id);
  const own = [...mineIds];
  const settings = siteSettings(siteId);

  const members = memberIdsOfUnit(unit.id)
    .map((id) => findUserById(id))
    .filter((member): member is User => member !== null);
  const property = propertyFor(unit, live.buildings, live.spaces, at);

  return {
    ...live,
    properties: [property],
    residents: members.map((member) => ({ id: member.id, name: member.name, phone: '', email: '', ...asOf(at) })),
    associations: members.map((member) => ({ id: `asc-${unit.id}-${member.id}`, residentId: member.id, propertyId: unit.id, role: memberRole(member.id) === 'owner' ? 'owner' : 'tenant', ...asOf(at) })),
    vehicles: rowsWhere('vehicles', siteId, 'resident_id', user.id).map((row) => decode(row, true)),
    reservations,
    invitations: rowsForReservations('invitations', siteId, own)
      .map((row) => decode<ParkingDb['invitations'][number]>(row, false))
      .map((invitation) => ({ ...invitation, ...(invitation.revokedAt ? {} : { inviteToken: invitationToken(invitation) }) })),
    credentials: rowsForReservations('credentials', siteId, own)
      .map((row) => decode<ParkingDb['credentials'][number]>(row, false))
      .map((credential) => ({ ...credential, ...(credential.status === 'active' ? { displayToken: credentialToken(credential) } : {}) })),
    sessions: rowsForReservations('sessions', siteId, own).map((row) => decode(row, false)),
    allocations: rowsForReservations('allocations', siteId, ids).map((row) => decode<ChargingAllocation>(row, false)),
    chargingSessions: rowsForReservations('charging_sessions', siteId, ids).map((row) => decode<ChargingSession>(row, false)),
    scanEvents: rowsForReservations('scan_events', siteId, own).map((row) => decode(row, true)),
    occupancyEvents: [],
    notifications: rowsForReservations('notifications', siteId, own).map((row) => decode<ParkingDb['notifications'][number]>(row, true)).filter((n) => n.audience === 'owner'),
    audit: rowsForReservations('audit', siteId, own, 'entity_id').map((row) => decode(row, true)),
    me: { residentId: user.id, propertyId: unit.id },
    inviteBase: `${base}/parking/pass`,
    securityPhone: settings.managementPhone ?? settings.emergencyPhone,
    serverNow: at,
  };
}

/** The whole layout with live occupancy, for security's desk. */
export function siteLayout(siteId: string, nowMs = Date.now()) {
  const { db } = loadParkingDb(siteId, 'transaction', nowMs);
  return { buildings: db.buildings, zones: db.zones, spaces: db.spaces, gates: db.gates, chargers: db.chargers, connectors: db.connectors };
}

