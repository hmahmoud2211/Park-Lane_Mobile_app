/**
 * Fictional demo data, relative to the demo clock.
 *
 * Rather than writing finished records by hand, the seed replays the real
 * operations (book, scan in, plug in, scan out, fault a charger) at past
 * instants, with the scheduled rules running between them. So every seeded
 * no-show, overstay and gate event was produced by the same code the app
 * uses, and the history is internally consistent.
 */
import { faultCharger, plugIn } from './charging';
import { scanPass } from './gate';
import { setOccupancy, setServiceability } from './operations';
import { defaultPolicy } from './policy';
import { cancelReservation, createReservation, type ReservationInput } from './reservations';
import { computeRoute, routeText } from './routing';
import { runScheduledRules } from './scheduler';
import {
  associationDefs,
  buildingDefs,
  chargerDefs,
  connectorDefs,
  gateDefs,
  propertyDefs,
  residentDefs,
  spaceDefs,
  vehicleDefs,
  zoneDefs,
} from './site';
import { HOUR_MS, MINUTE_MS, addDaysToKey, cairoDateKey, cairoToUtc, iso } from './time';
import { createTx, type Tx } from './tx';
import type { Entity, ParkingDb, ParkingSpace } from './types';

export const SCHEMA_VERSION = 6;

const M = MINUTE_MS;
const H = HOUR_MS;

function stamp<T extends object>(defs: T[], at: string): (T & Entity)[] {
  return defs.map((def) => ({ ...def, createdAt: at, updatedAt: at, version: 1 }) as T & Entity);
}

/** Bays with their computed route and written directions, all in service and vacant. */
function buildSpaces(at: string): ParkingSpace[] {
  return spaceDefs.map((def) => {
    const gate = gateDefs.find((g) => g.id === def.gateId)!;
    const route = computeRoute(def, gate, spaceDefs.filter((s) => s.zoneId === def.zoneId));
    return {
      ...def,
      serviceability: 'in-service',
      occupancy: 'vacant',
      occupancySince: at,
      route,
      instructions: routeText(route),
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
  });
}

/** The site with no bookings or events: the starting point for checks. */
export function baseDb(createdAt: string): ParkingDb {
  return {
    schemaVersion: SCHEMA_VERSION,
    policy: { ...defaultPolicy },
    revision: 0,
    clockOffsetMs: 0,
    referenceSerial: 0,
    buildings: stamp(buildingDefs, createdAt),
    properties: stamp(propertyDefs, createdAt),
    residents: stamp(residentDefs, createdAt),
    associations: stamp(associationDefs, createdAt),
    vehicles: stamp(vehicleDefs, createdAt),
    zones: stamp(zoneDefs, createdAt),
    spaces: buildSpaces(createdAt),
    gates: stamp(gateDefs, createdAt),
    chargers: stamp(chargerDefs, createdAt),
    connectors: stamp(connectorDefs, createdAt),
    reservations: [],
    invitations: [],
    credentials: [],
    sessions: [],
    allocations: [],
    chargingSessions: [],
    scanEvents: [],
    occupancyEvents: [],
    notifications: [],
    audit: [],
  };
}

/** Runs a step as if it happened at `at`, after the rules due by then. */
function at(db: ParkingDb, when: number, step: (tx: Tx) => void) {
  const tx = createTx(db, when);
  runScheduledRules(tx);
  step(tx);
}

const tokenOf = (db: ParkingDb, reservationId: string) => {
  const r = db.reservations.find((x) => x.id === reservationId)!;
  return db.credentials.find((c) => c.id === r.credentialId)!.displayToken;
};

/**
 * Builds the store as it would look at `nowMs`. `nowMs` is rounded down to
 * five minutes so the seeded times read cleanly.
 */
export function createSeed(nowMs: number): ParkingDb {
  const N = Math.floor(nowMs / (5 * M)) * 5 * M;
  const db = baseDb(iso(N - 30 * 24 * H));

  const guest = (
    propertyId: string,
    residentId: string,
    name: string,
    plate: string | undefined,
    spaceId: string,
    start: number,
    end: number,
    phone?: string,
  ): ReservationInput => ({
    propertyId,
    residentId,
    bookedFor: 'guest',
    guest: { name, phone },
    vehiclePlate: plate,
    parkingType: 'standard',
    spaceId,
    start,
    end,
  });

  // Steps are collected, then replayed in time order.
  const steps: [number, (tx: Tx) => void][] = [];
  const step = (when: number, fn: (tx: Tx) => void) => steps.push([when, fn]);

  // The resident's own car in their own bay, and the site's standing state.
  step(N - 26 * H, (tx) => {
    setOccupancy(tx, 'sp-P2-148', 'occupied', 'demo', 'Resident vehicle EGY 5678');
    setServiceability(tx, 'sp-V-013', 'maintenance', 'demo', 'Line repainting');
    setServiceability(tx, 'sp-V-026', 'out-of-service', 'demo', 'Drainage works');
  });

  // Yesterday: a completed visit with real entry and exit events.
  const Y = N - 24 * H;
  let done = '';
  step(Y - 2 * H, (tx) => {
    done = createReservation(tx, guest('prop-a302', 'res-ahmed', 'Sara Lamees', 'EGY 4321', 'sp-V-012', Y, Y + 3 * H)).id;
  });
  step(Y + 5 * M, (tx) => void scanPass(tx, tokenOf(db, done), 'gate-1', 'entry'));
  step(Y + 2 * H + 40 * M, (tx) => void scanPass(tx, tokenOf(db, done), 'gate-1', 'exit'));

  // A visit the resident called off.
  step(Y + 3 * H, (tx) => {
    const r = createReservation(tx, guest('prop-b1104', 'res-ahmed', 'Karim Samy', 'EGY 2020', 'sp-V-023', N + 3 * H, N + 6 * H));
    cancelReservation(tx, r.id, 'resident', 'Plans changed');
  });

  // An overstay: due out 30 minutes ago and still inside.
  let overdue = '';
  step(N - 6 * H, (tx) => {
    overdue = createReservation(tx, guest('prop-c0705', 'res-laila', 'Hany Fawzy', 'EGY 7788', 'sp-V-024', N - 4 * H, N - 30 * M)).id;
  });
  step(N - 4 * H + 5 * M, (tx) => void scanPass(tx, tokenOf(db, overdue), 'gate-2', 'entry'));

  // A visitor who never came: expires 20 minutes after the booked arrival.
  step(N - 5 * H, (tx) => {
    createReservation(tx, guest('prop-a302', 'res-ahmed', 'Mona Said', 'EGY 3344', 'sp-V-014', N - 3 * H, N - 1 * H));
  });

  // A visit in progress.
  let active = '';
  step(N - 3 * H, (tx) => {
    active = createReservation(
      tx,
      guest('prop-b1104', 'res-ahmed', 'Sara Lamees', 'EGY 4321', 'sp-V-021', N - 75 * M, N + 2 * H, '+20 11 0000 5566'),
    ).id;
  });

  // Booked into the overstayed bay before the overstay began: flagged once it does.
  step(N - 2 * H, (tx) => {
    createReservation(tx, guest('prop-b1104', 'res-ahmed', 'Mohamed Ali', 'EGY 9911', 'sp-V-024', N + 40 * M, N + 3 * H));
  });

  // A visitor's EV, charging now on the DC charger.
  let charging = '';
  step(N - 2 * H, (tx) => {
    charging = createReservation(tx, {
      propertyId: 'prop-c0705',
      residentId: 'res-laila',
      bookedFor: 'guest',
      guest: { name: 'Rana Fathy' },
      vehiclePlate: 'EGY 6620',
      parkingType: 'ev',
      spaceId: 'sp-EV-03',
      start: N - 50 * M,
      end: N + 2 * H + 50 * M,
      charging: { connectorType: 'CCS2', start: N - 45 * M, end: N + 2 * H + 15 * M, targetKwh: 40 },
    }).id;
  });
  step(N - 48 * M, (tx) => void scanPass(tx, tokenOf(db, charging), 'gate-2', 'entry'));
  step(N - 40 * M, (tx) => void plugIn(tx, charging, 'visitor'));

  // Booked on Charger C, which then faults: flagged for a compatible alternative.
  step(N - 90 * M, (tx) => {
    createReservation(tx, {
      propertyId: 'prop-b1104',
      residentId: 'res-ahmed',
      bookedFor: 'guest',
      guest: { name: 'Ziad Kamal' },
      vehiclePlate: 'EGY 7070',
      parkingType: 'ev',
      spaceId: 'sp-EV-05',
      start: N + 3 * H,
      end: N + 5 * H,
      charging: { connectorType: 'Type 2', start: N + 3 * H, end: N + 4 * H + 30 * M, targetKwh: 15 },
    });
  });

  // A bay whose sensor stopped reporting.
  step(N - 2 * H, (tx) => setOccupancy(tx, 'sp-V-016', 'unknown', 'demo', 'Bay sensor offline'));

  // Running late: still inside the 20-minute grace period.
  step(N - 60 * M, (tx) => {
    createReservation(tx, guest('prop-a302', 'res-ahmed', 'Tarek Nabil', 'EGY 5512', 'sp-V-015', N - 10 * M, N + 2 * H));
  });

  step(N - 20 * M, (tx) => {
    faultCharger(tx, 'chg-c', 'demo');
    // The resident's own EV, charging later today on Charger A.
    createReservation(tx, {
      propertyId: 'prop-a302',
      residentId: 'res-ahmed',
      bookedFor: 'resident',
      vehicleId: 'veh-ioniq',
      vehiclePlate: 'EGY 2468',
      parkingType: 'ev',
      spaceId: 'sp-EV-01',
      start: N + 1 * H,
      end: N + 4 * H,
      charging: { connectorType: 'Type 2', start: N + 1 * H, end: N + 3 * H, targetKwh: 20 },
    });
  });

  step(N - 30 * M, (tx) => {
    createReservation(tx, guest('prop-a302', 'res-ahmed', 'Omar Khaled', 'EGY 4821', 'sp-V-011', N + 2 * H, N + 5 * H, '+20 10 0000 4455'));
  });

  // Tomorrow evening; the visitor will add their own plate from the pass.
  step(N - 10 * M, (tx) => {
    const tomorrow = addDaysToKey(cairoDateKey(N), 1);
    createReservation(
      tx,
      guest('prop-b1104', 'res-ahmed', 'Nour Adel', undefined, 'sp-V-022', cairoToUtc(tomorrow, 18 * 60), cairoToUtc(tomorrow, 21 * 60)),
    );
  });

  step(N - 70 * M, (tx) => void scanPass(tx, tokenOf(db, active), 'gate-2', 'entry'));

  steps
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry[0] - b.entry[0] || a.index - b.index)
    .forEach(({ entry: [when, fn] }) => at(db, when, fn));

  at(db, nowMs, () => undefined);
  // Nothing seeded is "new" to the resident.
  for (const n of db.notifications) {
    if (Date.parse(n.at) < N - 2 * H) n.readAt = n.at;
  }
  return db;
}
