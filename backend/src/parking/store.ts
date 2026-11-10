import { transaction } from '../ems/db.ts';
import { seal, unseal } from '../ems/secrets.ts';
import {
  allRows,
  deleteRowsWhere,
  findParkingSite,
  insertRow,
  liveNotificationRows,
  liveReservationRows,
  reservationRowsOfResident,
  rowsOfLiveReservations,
  saveParkingSite,
  updateRow,
  type ParkingTable,
  type StoredRow,
} from '../repositories/parking.ts';
import { defaultPolicy } from './engine/policy.ts';
import { runScheduledRules } from './engine/scheduler.ts';
import { baseDb, SCHEMA_VERSION } from './engine/seed.ts';
import { createTx, type Tx } from './engine/tx.ts';
import type { Entity, ParkingDb } from './engine/types.ts';

/**
 * Where the parking rules keep their data on the server, and their unit of work.
 *
 * `runParking` does what the app's repository did on the phone, inside one SQLite `BEGIN IMMEDIATE`: load what a
 * rule can touch, run the scheduled rules (no-shows, overdue visits, charging windows), run the operation, then
 * write back only the rows whose `version` changed and the new ones. One process with synchronous SQLite gives the
 * same order the phone had, so a booking's availability check and its insert are one step and two at once can't
 * both win. Rows that can name a person or a plate are sealed.
 */

type Collection = Exclude<keyof ParkingDb, 'schemaVersion' | 'policy' | 'revision' | 'clockOffsetMs' | 'referenceSerial'>;

interface Spec {
  table: ParkingTable;
  sealed: boolean;
  /** The table's extra columns, from the record. */
  columns?: (row: never) => Record<string, unknown>;
}

const isoOr = (value: unknown) => (typeof value === 'string' ? value : null);

const SPECS: Record<Collection, Spec> = {
  buildings: { table: 'buildings', sealed: false },
  zones: { table: 'zones', sealed: false },
  spaces: { table: 'spaces', sealed: false },
  gates: { table: 'gates', sealed: false },
  chargers: { table: 'chargers', sealed: false },
  connectors: { table: 'connectors', sealed: false },
  residents: { table: 'residents', sealed: true },
  properties: { table: 'properties', sealed: false },
  associations: { table: 'associations', sealed: false, columns: (row: { residentId: string; propertyId: string }) => ({ resident_id: row.residentId, property_id: row.propertyId }) },
  vehicles: { table: 'vehicles', sealed: true, columns: (row: { residentId: string }) => ({ resident_id: row.residentId }) },
  reservations: {
    table: 'reservations',
    sealed: true,
    columns: (row: { propertyId: string; residentId: string; status: string; scheduledEnd: string }) => ({
      property_id: row.propertyId,
      resident_id: row.residentId || null,
      status: row.status,
      scheduled_end: row.scheduledEnd,
    }),
  },
  invitations: { table: 'invitations', sealed: false, columns: (row: { reservationId: string; inviteHash: string }) => ({ reservation_id: row.reservationId, invite_hash: row.inviteHash }) },
  credentials: { table: 'credentials', sealed: false, columns: (row: { reservationId: string; tokenHash: string }) => ({ reservation_id: row.reservationId, token_hash: row.tokenHash }) },
  sessions: { table: 'sessions', sealed: false, columns: (row: { reservationId: string }) => ({ reservation_id: row.reservationId }) },
  allocations: { table: 'allocations', sealed: false, columns: (row: { reservationId: string }) => ({ reservation_id: row.reservationId }) },
  chargingSessions: { table: 'charging_sessions', sealed: false, columns: (row: { reservationId: string }) => ({ reservation_id: row.reservationId }) },
  scanEvents: { table: 'scan_events', sealed: true, columns: (row: { at: string; reservationId?: string }) => ({ at: row.at, reservation_id: row.reservationId ?? null }) },
  occupancyEvents: { table: 'occupancy_events', sealed: false, columns: (row: { at: string; spaceId: string }) => ({ at: row.at, space_id: row.spaceId }) },
  notifications: {
    table: 'notifications',
    sealed: true,
    columns: (row: { at: string; audience: string; residentId?: string; reservationId?: string; readAt?: string; resolvedAt?: string }) => ({
      at: row.at,
      audience: row.audience,
      resident_id: row.residentId ?? null,
      reservation_id: row.reservationId ?? null,
      open: !isoOr(row.readAt) || (row.audience === 'operator' && !isoOr(row.resolvedAt)) ? 1 : 0,
    }),
  },
  audit: { table: 'audit', sealed: true, columns: (row: { at: string; entityId: string }) => ({ at: row.at, entity_id: row.entityId }) },
};

const COLLECTIONS = Object.keys(SPECS) as Collection[];
const CONFIG: readonly Collection[] = ['buildings', 'zones', 'spaces', 'gates', 'chargers', 'connectors'];
/** A rule can still touch a reservation that ended this recently (late exits, move-out deadlines). */
const LIVE_WINDOW_MS = 7 * 86_400_000;
/** Open notifications older than this are left alone. */
const OPEN_NOTIFICATION_WINDOW_MS = 90 * 86_400_000;

const decode = (spec: Spec, row: StoredRow) => JSON.parse(spec.sealed ? unseal(row.data) : row.data) as Entity;
const encode = (spec: Spec, entity: Entity) => (spec.sealed ? seal(JSON.stringify(entity)) : JSON.stringify(entity));

// ---- the site's parking ------------------------------------------------------------------------------

/**
 * Makes sure the site has parking: the layout of bays, gates and chargers (the design's site plan, with each bay's
 * route worked out once) and the default policy. Nothing else is seeded: no people, vehicles or bookings.
 */
export function ensureParkingSite(siteId: string, nowMs = Date.now()): void {
  if (findParkingSite(siteId)) return;
  const at = new Date(nowMs).toISOString();
  const layout = baseDb(at);
  transaction(() => {
    if (findParkingSite(siteId)) return;
    saveParkingSite({ site_id: siteId, policy: JSON.stringify(defaultPolicy), reference_serial: 0, revision: 0, created_at: at, updated_at: at });
    for (const collection of CONFIG) {
      for (const entity of layout[collection] as Entity[]) writeNew(collection, siteId, entity);
    }
  });
}

/** Imports a whole engine store onto a site (tests, and the development seed): people, layout and history. */
export function importParkingDb(siteId: string, source: ParkingDb, nowMs = Date.now()): void {
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    saveParkingSite({ site_id: siteId, policy: JSON.stringify(source.policy), reference_serial: source.referenceSerial, revision: source.revision, created_at: at, updated_at: at });
    for (const collection of COLLECTIONS) {
      for (const entity of source[collection] as Entity[]) writeNew(collection, siteId, entity);
    }
  });
}

function writeNew(collection: Collection, siteId: string, entity: Entity) {
  const spec = SPECS[collection];
  insertRow(spec.table, siteId, { id: entity.id, version: entity.version, data: encode(spec, entity) }, spec.columns ? spec.columns(entity as never) : {});
}

interface Loaded {
  db: ParkingDb;
  versions: Map<Collection, Map<string, number>>;
  site: { policy: string; referenceSerial: number; revision: number; createdAt: string };
}

function emptyDb(): ParkingDb {
  const db = baseDb(new Date(0).toISOString());
  for (const collection of COLLECTIONS) (db[collection] as Entity[]) = [];
  return db;
}

/**
 * Loads the site's store. `scope: 'transaction'` loads what a rule can touch (all of the layout, people and
 * vehicles; open and recent bookings with their passes, sessions and charging; recent and open notifications;
 * none of the append-only logs). `scope: 'full'` loads everything (tests, and the read models built from it).
 */
export function loadParkingDb(siteId: string, scope: 'transaction' | 'full', nowMs = Date.now()): Loaded {
  ensureParkingSite(siteId, nowMs);
  const site = findParkingSite(siteId)!;
  const db = emptyDb();
  db.schemaVersion = SCHEMA_VERSION;
  db.policy = JSON.parse(site.policy);
  db.referenceSerial = site.reference_serial;
  db.revision = site.revision;
  db.clockOffsetMs = 0;
  const since = new Date(nowMs - LIVE_WINDOW_MS).toISOString();
  const versions = new Map<Collection, Map<string, number>>();
  for (const collection of COLLECTIONS) {
    const spec = SPECS[collection];
    let rows: StoredRow[];
    if (scope === 'full' || ['buildings', 'zones', 'spaces', 'gates', 'chargers', 'connectors', 'residents', 'properties', 'associations', 'vehicles'].includes(collection)) {
      rows = allRows(spec.table, siteId);
    } else if (collection === 'reservations') {
      rows = liveReservationRows(siteId, since);
    } else if (spec.table === 'invitations' || spec.table === 'credentials' || spec.table === 'sessions' || spec.table === 'allocations' || spec.table === 'charging_sessions') {
      rows = rowsOfLiveReservations(spec.table, siteId, since);
    } else if (collection === 'notifications') {
      rows = liveNotificationRows(siteId, since, new Date(nowMs - OPEN_NOTIFICATION_WINDOW_MS).toISOString());
    } else {
      rows = [];
    }
    const entities = rows.map((row) => decode(spec, row));
    (db[collection] as Entity[]) = entities;
    versions.set(collection, new Map(entities.map((entity) => [entity.id, entity.version])));
  }
  return { db, versions, site: { policy: site.policy, referenceSerial: site.reference_serial, revision: site.revision, createdAt: site.created_at } };
}

/** Writes back what changed: new rows, and rows whose version moved. Returns what was new, for follow-ups. */
function saveChanges(siteId: string, loaded: Loaded, nowMs: number): { created: Map<Collection, Entity[]>; changed: boolean } {
  const created = new Map<Collection, Entity[]>();
  let changed = false;
  for (const collection of COLLECTIONS) {
    const spec = SPECS[collection];
    const before = loaded.versions.get(collection)!;
    for (const entity of loaded.db[collection] as Entity[]) {
      const previous = before.get(entity.id);
      if (previous === undefined) {
        writeNew(collection, siteId, entity);
        created.set(collection, [...(created.get(collection) ?? []), entity]);
        changed = true;
      } else if (previous !== entity.version) {
        updateRow(spec.table, siteId, { id: entity.id, version: entity.version, data: encode(spec, entity) }, spec.columns ? spec.columns(entity as never) : {});
        changed = true;
      }
    }
  }
  const policy = JSON.stringify(loaded.db.policy);
  if (changed || policy !== loaded.site.policy || loaded.db.referenceSerial !== loaded.site.referenceSerial) {
    saveParkingSite({
      site_id: siteId,
      policy,
      reference_serial: loaded.db.referenceSerial,
      revision: loaded.site.revision + 1,
      created_at: loaded.site.createdAt,
      updated_at: new Date(nowMs).toISOString(),
    });
    changed = true;
  }
  return { created, changed };
}

export interface ParkingOutcome<T> {
  result: T;
  /** Notifications the rules raised in this step, to pass to the inbox. */
  notifications: ParkingDb['notifications'];
  changed: boolean;
}

/**
 * One atomic step: the scheduled rules, then `operation` (which may first prepare the store, e.g. make sure the
 * signed-in resident is known). Anything thrown discards the whole step.
 */
export function runParking<T>(siteId: string, operation: (tx: Tx) => T, nowMs = Date.now()): ParkingOutcome<T> {
  ensureParkingSite(siteId, nowMs);
  return transaction(() => {
    const loaded = loadParkingDb(siteId, 'transaction', nowMs);
    const tx = createTx(loaded.db, nowMs);
    runScheduledRules(tx);
    const result = operation(tx);
    const { created, changed } = saveChanges(siteId, loaded, nowMs);
    return { result, notifications: (created.get('notifications') ?? []) as ParkingDb['notifications'], changed };
  });
}

/**
 * After the rules cancelled a leaving person's upcoming bookings (parking/accounts.ts): their past bookings stay as
 * the gate's log without naming them, and their own parking rows go (who they were, their vehicles, their alerts).
 */
export function forgetResidentRows(userId: string): void {
  transaction(() => {
    const spec = SPECS.reservations;
    for (const row of reservationRowsOfResident(userId)) {
      const reservation = decode(spec, row) as ParkingDb['reservations'][number];
      reservation.residentId = '';
      reservation.version += 1;
      updateRow(spec.table, row.site_id, { id: row.id, version: reservation.version, data: encode(spec, reservation) }, spec.columns!(reservation as never));
    }
    deleteRowsWhere('residents', 'id', userId);
    deleteRowsWhere('vehicles', 'resident_id', userId);
    deleteRowsWhere('associations', 'resident_id', userId);
    deleteRowsWhere('notifications', 'resident_id', userId);
  });
}
