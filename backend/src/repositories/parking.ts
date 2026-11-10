import { db } from '../ems/db.ts';

/**
 * The parking_* tables (migration 18). Each holds one collection of the parking rules engine as JSON in `data`,
 * plus a few columns for loading only what a rule can touch. parking/store.ts maps collections to tables and seals.
 */

export interface ParkingSiteRow {
  site_id: string;
  policy: string;
  reference_serial: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface StoredRow {
  id: string;
  version: number;
  data: string;
}

/** The tables and their extra columns, in insert order. Names are fixed here, never taken from a request. */
export const PARKING_TABLES = {
  buildings: [],
  zones: [],
  spaces: [],
  gates: [],
  chargers: [],
  connectors: [],
  residents: [],
  properties: [],
  associations: ['resident_id', 'property_id'],
  vehicles: ['resident_id'],
  reservations: ['property_id', 'resident_id', 'status', 'scheduled_end'],
  invitations: ['reservation_id', 'invite_hash'],
  credentials: ['reservation_id', 'token_hash'],
  sessions: ['reservation_id'],
  allocations: ['reservation_id'],
  charging_sessions: ['reservation_id'],
  scan_events: ['at', 'reservation_id'],
  occupancy_events: ['at', 'space_id'],
  notifications: ['at', 'audience', 'resident_id', 'reservation_id', 'open'],
  audit: ['at', 'entity_id'],
} as const satisfies Record<string, readonly string[]>;

export type ParkingTable = keyof typeof PARKING_TABLES;

export function findParkingSite(siteId: string): ParkingSiteRow | undefined {
  return db().prepare('SELECT * FROM parking_sites WHERE site_id = ?').get(siteId) as ParkingSiteRow | undefined;
}

export function saveParkingSite(row: ParkingSiteRow): void {
  db()
    .prepare(
      `INSERT INTO parking_sites (site_id, policy, reference_serial, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET policy = excluded.policy, reference_serial = excluded.reference_serial,
         revision = excluded.revision, updated_at = excluded.updated_at`,
    )
    .run(row.site_id, row.policy, row.reference_serial, row.revision, row.created_at, row.updated_at);
}

/** Every row of a table on the site. */
export function allRows(table: ParkingTable, siteId: string): StoredRow[] {
  return db().prepare(`SELECT id, version, data FROM parking_${table} WHERE site_id = ?`).all(siteId) as unknown as StoredRow[];
}

/** The reservations a rule can still touch: open ones, and those that ended after `since`. */
const LIVE_RESERVATIONS = "SELECT id FROM parking_reservations WHERE site_id = ? AND (status IN ('confirmed', 'checked-in') OR scheduled_end >= ?)";

export function liveReservationRows(siteId: string, since: string): StoredRow[] {
  return db()
    .prepare(`SELECT id, version, data FROM parking_reservations WHERE site_id = ? AND (status IN ('confirmed', 'checked-in') OR scheduled_end >= ?)`)
    .all(siteId, since) as unknown as StoredRow[];
}

/** Rows of a table that belong to those reservations. */
export function rowsOfLiveReservations(table: 'invitations' | 'credentials' | 'sessions' | 'allocations' | 'charging_sessions', siteId: string, since: string): StoredRow[] {
  return db()
    .prepare(`SELECT id, version, data FROM parking_${table} WHERE site_id = ? AND reservation_id IN (${LIVE_RESERVATIONS})`)
    .all(siteId, siteId, since) as unknown as StoredRow[];
}

/** Notifications a rule may close: recent ones, and open ones that are not too old. */
export function liveNotificationRows(siteId: string, recentSince: string, openSince: string): StoredRow[] {
  return db()
    .prepare('SELECT id, version, data FROM parking_notifications WHERE site_id = ? AND (at >= ? OR (open = 1 AND at >= ?))')
    .all(siteId, recentSince, openSince) as unknown as StoredRow[];
}

/** One property's reservations from `since` on (its history), and every open one on the site. */
export function reservationRowsFor(siteId: string, propertyId: string, since: string): StoredRow[] {
  return db()
    .prepare(
      `SELECT id, version, data FROM parking_reservations WHERE site_id = ? AND
         ((property_id = ? AND scheduled_end >= ?) OR status IN ('confirmed', 'checked-in'))`,
    )
    .all(siteId, propertyId, since) as unknown as StoredRow[];
}

export function rowsForReservations(table: ParkingTable, siteId: string, reservationIds: readonly string[], column = 'reservation_id'): StoredRow[] {
  if (reservationIds.length === 0) return [];
  const placeholders = reservationIds.map(() => '?').join(', ');
  return db()
    .prepare(`SELECT id, version, data FROM parking_${table} WHERE site_id = ? AND ${column} IN (${placeholders})`)
    .all(siteId, ...reservationIds) as unknown as StoredRow[];
}

export function findByHash(table: 'invitations' | 'credentials', hash: string): { id: string; reservation_id: string; site_id: string } | undefined {
  const column = table === 'invitations' ? 'invite_hash' : 'token_hash';
  return db().prepare(`SELECT id, reservation_id, site_id FROM parking_${table} WHERE ${column} = ?`).get(hash) as
    | { id: string; reservation_id: string; site_id: string }
    | undefined;
}

export function rowsWhere(table: ParkingTable, siteId: string, column: string, value: string): StoredRow[] {
  return db().prepare(`SELECT id, version, data FROM parking_${table} WHERE site_id = ? AND ${column} = ?`).all(siteId, value) as unknown as StoredRow[];
}

export function insertRow(table: ParkingTable, siteId: string, row: StoredRow, columns: Record<string, unknown>): void {
  const extra = PARKING_TABLES[table] as readonly string[];
  const names = ['id', 'site_id', 'version', 'data', ...extra];
  db()
    .prepare(`INSERT INTO parking_${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(row.id, siteId, row.version, row.data, ...extra.map((name) => (columns[name] ?? null) as string | number | null));
}

export function updateRow(table: ParkingTable, siteId: string, row: StoredRow, columns: Record<string, unknown>): void {
  const extra = PARKING_TABLES[table] as readonly string[];
  const sets = ['version = ?', 'data = ?', ...extra.map((name) => `${name} = ?`)];
  db()
    .prepare(`UPDATE parking_${table} SET ${sets.join(', ')} WHERE site_id = ? AND id = ?`)
    .run(row.version, row.data, ...extra.map((name) => (columns[name] ?? null) as string | number | null), siteId, row.id);
}

export function deleteRowsWhere(table: ParkingTable, column: string, value: string): number {
  return Number(db().prepare(`DELETE FROM parking_${table} WHERE ${column} = ?`).run(value).changes);
}

/** Users who may act for the compound's gates (security and admins), for operator alerts. */
export function staffUserIds(): string[] {
  return (db().prepare("SELECT id FROM users WHERE role IN ('security', 'admin')").all() as { id: string }[]).map((row) => row.id);
}

export function parkingSiteIds(): string[] {
  return (db().prepare('SELECT site_id FROM parking_sites').all() as { site_id: string }[]).map((row) => row.site_id);
}

/** Every reservation one person booked, on any compound (account deletion). */
export function reservationRowsOfResident(userId: string): (StoredRow & { site_id: string })[] {
  return db().prepare('SELECT site_id, id, version, data FROM parking_reservations WHERE resident_id = ?').all(userId) as unknown as (StoredRow & { site_id: string })[];
}
