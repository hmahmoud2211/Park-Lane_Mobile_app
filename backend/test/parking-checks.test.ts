import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * The parking rules' 23 acceptance checks (frontend/src/features/parking/services/checks.ts), run against the
 * backend's SQLite store instead of the phone's memory store: every step goes through parking/store.ts runParking.
 * The checks are copied word for word, except two the backend replaces: "refreshing the app" (now: a new service
 * reads the database) and the demo's snapshot pass links (removed; now: no token is stored and the link is the key).
 */

Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-parking-checks-')), ADMIN_API_KEY: '', EMS_DEFAULT_USERNAME: '', EMS_DEFAULT_PASSWORD: '' });

const { db } = await import('../src/ems/db.ts');
const { insertSite } = await import('../src/repositories/sites.ts');
const { chargerFreeNow } = await import('../src/parking/engine/availability.ts');
const { credentialToken, invitationToken } = await import('../src/parking/engine/crypto.ts');
const { stepText } = await import('../src/parking/engine/i18n.ts');
const { baseDb, createSeed } = await import('../src/parking/engine/seed.ts');
const { dashboardCounts, findInvitation, findReservation, reservationView, directionsText } = await import('../src/parking/engine/selectors.ts');
const { HOUR_MS, MINUTE_MS, iso } = await import('../src/parking/engine/time.ts');
const { expectedArrivals, guestTracker } = await import('../src/parking/engine/tracking.ts');
const { ParkingService } = await import('../src/parking/service.ts');
const { importParkingDb } = await import('../src/parking/store.ts');
type ParkingDb = import('../src/parking/engine/types.ts').ParkingDb;
type ParkingSpace = import('../src/parking/engine/types.ts').ParkingSpace;
type Reservation = import('../src/parking/engine/types.ts').Reservation;
void directionsText;

const H = HOUR_MS;
const M = MINUTE_MS;

/** 10:00 Cairo on a fixed day, so results do not depend on when the checks run. */
const T0 = Date.UTC(2026, 9, 13, 7, 0);

type Service = InstanceType<typeof ParkingService>;
/** The app's service returned promises; the backend's runs synchronously. The checks await, so wrap it. */
type Async<S> = { [K in keyof S]: S[K] extends (...args: infer A) => infer R ? (K extends 'search' | 'now' | 'snapshot' ? S[K] : (...args: A) => Promise<R>) : S[K] };

let sites = 0;
function harness() {
  let real = T0;
  const siteId = `parking-check-${++sites}`;
  insertSite({ id: siteId, name: siteId, timezone: 'Africa/Cairo', kind: 'demo', createdAt: iso(T0) });
  const start = baseDb(iso(T0 - 24 * H));
  start.spaces.find((s) => s.id === 'sp-V-013')!.serviceability = 'maintenance';
  start.chargers.find((c) => c.id === 'chg-c')!.status = 'faulted';
  importParkingDb(siteId, start, T0);
  const sync = new ParkingService(siteId, () => real);
  const service = new Proxy(sync, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (typeof value !== 'function' || key === 'search' || key === 'now' || key === 'snapshot') return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => {
        try {
          return Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
        } catch (error) {
          return Promise.reject(error);
        }
      };
    },
  }) as unknown as Async<Service>;
  return {
    siteId,
    service,
    repo: {
      now: () => real,
      get snapshot(): ParkingDb {
        return sync.snapshot();
      },
    },
    get db(): ParkingDb {
      return sync.snapshot();
    },
    setReal(next: number) {
      real = next;
    },
    space: (label: string): ParkingSpace => sync.snapshot().spaces.find((s) => s.label === label)!,
    res: (id: string): Reservation => findReservation(sync.snapshot(), id)!,
    token: (id: string) => {
      const snapshot = sync.snapshot();
      const r = findReservation(snapshot, id)!;
      return credentialToken(snapshot.credentials.find((c) => c.id === r.credentialId)!);
    },
  };
}

type Harness = ReturnType<typeof harness>;

const guestInput = (h: Harness, spaceLabel: string, start: number, end: number, name = 'Test Guest', plate: string | undefined = 'EGY 1000', propertyId = 'prop-a302') => ({
  propertyId,
  residentId: 'res-ahmed',
  bookedFor: 'guest' as const,
  guest: { name },
  vehiclePlate: plate,
  parkingType: 'standard' as const,
  spaceId: h.space(spaceLabel).id,
  start,
  end,
});

const visitorSearch = (h: Harness, start: number, end: number) =>
  h.service.search({ propertyId: 'prop-a302', kind: 'visitor', start, end });

const isOffered = (h: Harness, label: string, start: number, end: number) =>
  visitorSearch(h, start, end).some((o) => o.space.label === label && o.available);

async function expectError(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'error';
  }
}

type Check = [string, (h: Harness) => Promise<string>];

const checks: Check[] = [
  [
    'Creating a reservation removes that space from conflicting search results',
    async (h) => {
      const start = T0 + 2 * H;
      if (!isOffered(h, 'V-011', start, start + 2 * H)) throw new Error('V-011 not offered before booking');
      await h.service.createReservation(guestInput(h, 'V-011', start, start + 2 * H));
      const overlapping = isOffered(h, 'V-011', start + H, start + 3 * H);
      const later = isOffered(h, 'V-011', start + 2 * H + 10 * M, start + 4 * H);
      if (overlapping) throw new Error('still offered for an overlapping time');
      if (!later) throw new Error('not offered after the booking plus turnover');
      return 'V-011 hidden for 11:00–13:00 overlap, offered again from end + 10 min turnover';
    },
  ],
  [
    'Simultaneous conflicting requests produce only one confirmed reservation',
    async (h) => {
      const start = T0 + 3 * H;
      const results = await Promise.allSettled([
        h.service.createReservation(guestInput(h, 'V-021', start, start + H, 'First')),
        h.service.createReservation(guestInput(h, 'V-021', start + 30 * M, start + 90 * M, 'Second', 'EGY 2000', 'prop-b1104')),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const onBay = h.db.reservations.filter((r) => r.spaceId === h.space('V-021').id && r.status === 'confirmed').length;
      if (ok !== 1 || onBay !== 1) throw new Error(`${ok} succeeded, ${onBay} on the bay`);
      return '1 confirmed, 1 refused with space-unavailable';
    },
  ],
  [
    'Guest pass and internal directions display the assigned space',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-023', T0 + H, T0 + 2 * H));
      const view = reservationView(h.db, h.res(r.id), h.repo.now());
      const text = directionsText(view);
      const { steps, walk } = view.space.route;
      const park = steps[steps.length - 1];
      const end = park.points[park.points.length - 1];
      const { map } = view.space;
      const inBay = end.x >= map.x && end.x <= map.x + map.w && end.y >= map.y && end.y <= map.y + map.h;
      if (view.space.label !== 'V-023' || !text.includes('V-023') || park.kind !== 'park' || !park.text.includes('V-023') || !inBay || steps[0].kind !== 'enter' || !walk) {
        throw new Error('pass or directions do not point at V-023');
      }
      // The EV hub is underground: its route must take the ramp and end on Basement 1.
      const ev = h.db.spaces.find((s) => s.label === 'EV-03')!.route.steps;
      if (!ev.some((s) => s.kind === 'ramp') || ev[ev.length - 1].levelId !== 'b1') throw new Error('EV route does not reach Basement 1');
      return `${steps.map((s) => s.text).join(' → ')}`;
    },
  ],
  [
    'Valid QR entry updates the session and occupancy',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + 2 * H));
      const result = await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      const after = h.res(r.id);
      const session = h.db.sessions.find((s) => s.reservationId === r.id);
      if (result.outcome !== 'accepted' || after.status !== 'checked-in' || h.space('V-012').occupancy !== 'occupied' || !session) {
        throw new Error(`${result.code}, ${after.status}, ${h.space('V-012').occupancy}`);
      }
      return 'checked in, session opened, V-012 occupied';
    },
  ],
  [
    'Duplicate entry has no duplicate effects',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + 2 * H));
      await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      const before = { events: h.db.scanEvents.length, sessions: h.db.sessions.length, version: h.res(r.id).version };
      const again = await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      const after = { events: h.db.scanEvents.length, sessions: h.db.sessions.length, version: h.res(r.id).version };
      if (again.code !== 'already-checked-in' || JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`${again.code}; ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      }
      return '"Already checked in", no new event, session or version';
    },
  ],
  [
    'Wrong-gate, revoked, premature and no-show passes are rejected clearly',
    async (h) => {
      const wrong = await h.service.createReservation(guestInput(h, 'V-014', T0, T0 + H));
      const wrongResult = await h.service.scan(h.token(wrong.id), 'gate-2', 'entry');

      const replaced = await h.service.createReservation(guestInput(h, 'V-015', T0, T0 + H, 'R', 'EGY 1001', 'prop-b1104'));
      const oldToken = h.token(replaced.id);
      await h.service.replacePass(replaced.id);
      const revokedResult = await h.service.scan(oldToken, 'gate-1', 'entry');

      const early = await h.service.createReservation(guestInput(h, 'V-016', T0 + 3 * H, T0 + 4 * H, 'E', 'EGY 1002', 'prop-b1104'));
      const earlyResult = await h.service.scan(h.token(early.id), 'gate-1', 'entry');

      h.setReal(T0 + 3 * H + 21 * M);
      const noShowResult = await h.service.scan(h.token(early.id), 'gate-1', 'entry');
      const codes = [wrongResult.code, revokedResult.code, earlyResult.code, noShowResult.code];
      const expected = ['wrong-gate', 'revoked-replaced', 'too-early', 'revoked-no-show'];
      if (JSON.stringify(codes) !== JSON.stringify(expected)) throw new Error(codes.join(', '));
      if (h.res(early.id).status !== 'no-show') throw new Error('not marked no-show');
      return codes.join(', ');
    },
  ],
  [
    'Early exit releases the remaining interval after the buffer',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + 4 * H));
      await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      h.setReal(T0 + H);
      await h.service.scan(h.token(r.id), 'gate-1', 'exit');
      const inBuffer = isOffered(h, 'V-012', T0 + H + 5 * M, T0 + 2 * H);
      const afterBuffer = isOffered(h, 'V-012', T0 + H + 10 * M, T0 + 3 * H);
      const kept = h.res(r.id);
      if (inBuffer || !afterBuffer || kept.scheduledEnd !== iso(T0 + 4 * H) || !kept.actualExitAt) {
        throw new Error(`buffer offered: ${inBuffer}, after: ${afterBuffer}`);
      }
      return 'free from exit + 10 min; booked and actual times both kept';
    },
  ],
  [
    'Passing the end while still inside creates an overstay, not a false vacancy',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-022', T0, T0 + H, 'O', 'EGY 1003', 'prop-b1104'));
      await h.service.scan(h.token(r.id), 'gate-2', 'entry');
      const next = await h.service.createReservation(guestInput(h, 'V-022', T0 + 2 * H, T0 + 3 * H, 'Next', 'EGY 1004'));
      h.setReal(T0 + 90 * M);
      await h.service.tick();
      const view = reservationView(h.db, h.res(r.id), h.repo.now());
      const offered = isOffered(h, 'V-022', T0 + 4 * H, T0 + 5 * H);
      const flagged = h.res(next.id).needsReassignment;
      if (view.status.key !== 'overdue' || h.space('V-022').occupancy !== 'occupied' || offered || !flagged || h.res(next.id).status !== 'confirmed') {
        throw new Error(`${view.status.key}, ${h.space('V-022').occupancy}, offered ${offered}, flagged ${Boolean(flagged)}`);
      }
      const told = h.db.notifications.filter((n) => n.reservationId === r.id && n.kind === 'overdue').map((n) => n.audience);
      if (!told.includes('owner') || !told.includes('operator')) throw new Error('owner/operator not notified');
      return 'overdue, bay still occupied and blocked, next booking flagged (not cancelled)';
    },
  ],
  [
    'An overdue visitor can still exit',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-022', T0, T0 + H, 'O', 'EGY 1003', 'prop-b1104'));
      await h.service.scan(h.token(r.id), 'gate-2', 'entry');
      h.setReal(T0 + 3 * H);
      const result = await h.service.scan(h.token(r.id), 'gate-3', 'exit');
      if (result.outcome !== 'accepted' || h.res(r.id).status !== 'completed' || h.space('V-022').occupancy !== 'vacant') {
        throw new Error(result.code);
      }
      return `${result.code}: completed, bay vacant`;
    },
  ],
  [
    'Duplicate exit is harmless',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + H));
      await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      await h.service.scan(h.token(r.id), 'gate-1', 'exit');
      const events = h.db.scanEvents.length;
      const again = await h.service.scan(h.token(r.id), 'gate-1', 'exit');
      if (again.code !== 'already-checked-out' || h.db.scanEvents.length !== events) throw new Error(again.code);
      return '"Already checked out", no new event';
    },
  ],
  [
    'A completed pass cannot be reused',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + 3 * H));
      await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      await h.service.scan(h.token(r.id), 'gate-1', 'exit');
      const reentry = await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      if (reentry.outcome !== 'rejected' || reentry.code !== 'pass-used') throw new Error(reentry.code);
      return 'pass-used: a new reservation is required';
    },
  ],
  [
    'EV booking checks both bay availability and charging capacity',
    async (h) => {
      const base = { propertyId: 'prop-a302', residentId: 'res-ahmed', bookedFor: 'guest' as const, vehiclePlate: 'EGY 3000', parkingType: 'ev' as const };
      await h.service.createReservation({ ...base, guest: { name: 'A' }, spaceId: 'sp-EV-03', start: T0 + H, end: T0 + 3 * H, charging: { connectorType: 'CCS2', start: T0 + H, end: T0 + 2 * H } });
      // EV-04 is a free bay, but its CHAdeMO plug shares Charger B, which charges one car at a time.
      const options = h.service.search({ propertyId: 'prop-b1104', kind: 'ev', start: T0 + H, end: T0 + 3 * H, connectorType: 'CHAdeMO', chargingStart: T0 + 90 * M, chargingEnd: T0 + 150 * M });
      const ev04 = options.find((o) => o.space.label === 'EV-04')!;
      const laterOk = h.service.search({ propertyId: 'prop-b1104', kind: 'ev', start: T0 + 2 * H, end: T0 + 4 * H, connectorType: 'CHAdeMO', chargingStart: T0 + 2 * H, chargingEnd: T0 + 3 * H }).find((o) => o.space.label === 'EV-04')!;
      if (ev04.available || !laterOk.available) throw new Error(`overlap ${ev04.available}, later ${laterOk.available}`);
      return `EV-04 refused while Charger B is busy ("${ev04.reason}"), offered after`;
    },
  ],
  [
    'Incompatible or faulted chargers cannot be booked',
    async (h) => {
      const options = h.service.search({ propertyId: 'prop-a302', kind: 'ev', start: T0 + H, end: T0 + 3 * H, connectorType: 'Type 2', chargingStart: T0 + H, chargingEnd: T0 + 2 * H });
      const faulted = options.find((o) => o.space.label === 'EV-05')!;
      const incompatible = options.find((o) => o.space.label === 'EV-03')!;
      const direct = await expectError(
        h.service.createReservation({ propertyId: 'prop-a302', residentId: 'res-ahmed', bookedFor: 'guest', guest: { name: 'X' }, vehiclePlate: 'EGY 3001', parkingType: 'ev', spaceId: 'sp-EV-05', start: T0 + H, end: T0 + 3 * H, charging: { connectorType: 'Type 2', start: T0 + H, end: T0 + 2 * H } }),
      );
      if (faulted.available || incompatible.available || direct !== 'charger-unavailable') throw new Error(`${faulted.reason}; ${incompatible.reason}; ${direct}`);
      return `EV-05: ${faulted.reason}; EV-03: ${incompatible.reason}`;
    },
  ],
  [
    'Charging completion does not imply physical vacancy',
    async (h) => {
      // Default shape: parking ends 15 minutes after the charging slot.
      const r = await h.service.createReservation({ propertyId: 'prop-a302', residentId: 'res-ahmed', bookedFor: 'resident', vehicleId: 'veh-ioniq', vehiclePlate: 'EGY 2468', parkingType: 'ev', spaceId: 'sp-EV-01', start: T0, end: T0 + 2 * H + 15 * M, charging: { connectorType: 'Type 2', start: T0, end: T0 + 2 * H, targetKwh: 10 } });
      await h.service.scan(h.token(r.id), 'gate-2', 'entry');
      if (h.db.chargingSessions.find((s) => s.reservationId === r.id)!.state !== 'waiting-for-plug-in') throw new Error('entry started charging');
      await h.service.plugIn(r.id);
      h.setReal(T0 + 80 * M); // 10 kWh at 9.9 kW takes about an hour
      await h.service.tick();
      const session = h.db.chargingSessions.find((s) => s.reservationId === r.id)!;
      const blocked = h.service.search({ propertyId: 'prop-a302', kind: 'ev', start: h.repo.now(), end: h.repo.now() + H, connectorType: 'Type 2', chargingStart: h.repo.now(), chargingEnd: h.repo.now() + H }).find((o) => o.space.label === 'EV-01')!;
      if (session.state !== 'completed' || h.space('EV-01').occupancy !== 'occupied' || blocked.available) throw new Error(`${session.state}, ${h.space('EV-01').occupancy}`);
      if (session.moveOutOverstayAt) throw new Error('flagged while the booked stay is still running');
      h.setReal(T0 + 2 * H + 20 * M);
      await h.service.tick();
      const overstay = h.db.chargingSessions.find((s) => s.reservationId === r.id)!.moveOutOverstayAt;
      const overdue = reservationView(h.db, h.res(r.id), h.repo.now()).overdue;
      await h.service.markMovedOut(r.id, 'operator', 'Moved to visitor court');
      if (!overstay || !overdue || h.space('EV-01').occupancy !== 'vacant' || h.res(r.id).status !== 'checked-in') throw new Error('move-out handling wrong');
      return 'charging completed, bay stayed occupied for the booked stay, overstay flagged after it; "moved out" freed the bay without a compound exit';
    },
  ],
  [
    'Failed edits and extensions preserve the original booking',
    async (h) => {
      const first = await h.service.createReservation(guestInput(h, 'V-011', T0 + H, T0 + 2 * H));
      await h.service.createReservation(guestInput(h, 'V-011', T0 + 3 * H, T0 + 4 * H, 'Later', 'EGY 1005', 'prop-b1104'));
      const before = JSON.stringify(h.res(first.id));
      const extend = await expectError(h.service.extendReservation(first.id, T0 + 3 * H + 30 * M, h.res(first.id).version));
      const move = await expectError(h.service.editReservation(first.id, { spaceId: h.space('V-013').id }, h.res(first.id).version));
      const stale = await expectError(h.service.editReservation(first.id, { end: T0 + 150 * M }, h.res(first.id).version - 1));
      if (!extend || !move || stale !== 'stale' || JSON.stringify(h.res(first.id)) !== before) throw new Error(`${extend}, ${move}, ${stale}`);
      const ok = await h.service.extendReservation(first.id, T0 + 150 * M, h.res(first.id).version);
      if (ok.scheduledEnd !== iso(T0 + 150 * M)) throw new Error('valid extension failed');
      return `${extend}, ${move} and ${stale} left it untouched; a valid extension then succeeded`;
    },
  ],
  [
    'A new service reads the committed booking back from the database',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0 + H, T0 + 2 * H));
      const reopened = new ParkingService(h.siteId, () => T0);
      const again = findReservation(reopened.snapshot(), r.id);
      if (!again || reopened.snapshot().revision !== h.repo.snapshot.revision) throw new Error('not reloaded');
      return `reloaded revision ${reopened.snapshot().revision} with the new booking`;
    },
  ],
  [
    'All dashboard totals reflect the same underlying data',
    async () => {
      const now = T0;
      const db = createSeed(now);
      const counts = dashboardCounts(db, now);
      const occupied = db.spaces.filter((s) => s.occupancy === 'occupied').length;
      const freeChargers = db.chargers.filter((c) => chargerFreeNow(db, c, now)).length;
      const ok =
        counts.guestAvailableNow + counts.evBayAvailableNow === counts.sharedAvailableNow &&
        counts.guestTotal + counts.evBayTotal === counts.sharedTotal &&
        counts.occupiedNow === occupied &&
        counts.chargerFreeNow === freeChargers &&
        counts.sharedAvailableNow <= counts.sharedTotal - db.spaces.filter((s) => s.kind !== 'resident' && (s.occupancy !== 'vacant' || s.serviceability !== 'in-service')).length;
      const seeded = {
        noShow: db.reservations.some((r) => r.status === 'no-show'),
        overdue: db.reservations.some((r) => reservationView(db, r, now).overdue),
        faulted: db.chargers.some((c) => c.status === 'faulted'),
        charging: db.chargingSessions.some((s) => s.state === 'charging'),
        flagged: db.reservations.some((r) => r.needsReassignment),
      };
      if (!ok || Object.values(seeded).includes(false)) throw new Error(JSON.stringify({ counts, seeded }));
      return `guest ${counts.guestAvailableNow}/${counts.guestTotal} + EV ${counts.evBayAvailableNow}/${counts.evBayTotal} = ${counts.sharedAvailableNow}/${counts.sharedTotal} free now; seed has no-show, overdue, fault, charging, flagged`;
    },
  ],
  [
    'Charger fault reassigns an upcoming EV booking atomically',
    async (h) => {
      const r = await h.service.createReservation({ propertyId: 'prop-a302', residentId: 'res-ahmed', bookedFor: 'guest', guest: { name: 'Z' }, vehiclePlate: 'EGY 3002', parkingType: 'ev', spaceId: 'sp-EV-02', start: T0 + 2 * H, end: T0 + 4 * H, charging: { connectorType: 'Type 2', start: T0 + 2 * H, end: T0 + 3 * H } });
      await h.service.faultCharger('chg-a');
      if (!h.res(r.id).needsReassignment) throw new Error('not flagged');
      // Every Type 2 alternative is down (A and C faulted): the move must fail and change nothing.
      const before = JSON.stringify(h.res(r.id));
      const failed = await expectError(h.service.reassign(r.id, 'resident'));
      if (failed !== 'no-alternative' || JSON.stringify(h.res(r.id)) !== before) throw new Error(`${failed}`);
      await h.service.restoreCharger('chg-c');
      const moved = await h.service.reassign(r.id, 'resident');
      if (h.db.spaces.find((s) => s.id === moved.spaceId)!.label !== 'EV-05' || moved.needsReassignment) throw new Error('not moved');
      return 'flagged on fault; failed move kept the booking; moved to EV-05 once Charger C was back';
    },
  ],
  [
    'The guest limit counts guests parked at the same moment, not back-to-back visits',
    async (h) => {
      await h.service.createReservation(guestInput(h, 'V-011', T0 + H, T0 + 3 * H, 'One', 'EGY 4001'));
      await h.service.createReservation(guestInput(h, 'V-012', T0 + 3 * H, T0 + 5 * H, 'Two', 'EGY 4002'));
      // Overlaps both, but never more than one of them at a time: 2 at once is allowed.
      await h.service.createReservation(guestInput(h, 'V-014', T0 + 2 * H, T0 + 4 * H, 'Three', 'EGY 4003'));
      // Now 2:00-3:00 has two guests (One, Three): a fourth there exceeds the limit of 2.
      const refused = await expectError(h.service.createReservation(guestInput(h, 'V-015', T0 + 150 * M, T0 + 170 * M, 'Four', 'EGY 4004')));
      if (refused !== 'guest-limit') throw new Error(`fourth guest: ${refused}`);
      return 'third guest across two back-to-back visits allowed; a third at the same moment refused (guest-limit)';
    },
  ],
  [
    'The owner’s tracker follows the visit from booking to exit',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0, T0 + 2 * H));
      const states = () => guestTracker(h.db, h.res(r.id), h.repo.now()).steps.map((s) => `${s.key}:${s.state}`).join(' ');
      const before = states();
      await h.service.recordShare(r.id, 'whatsapp');
      const shared = guestTracker(h.db, h.res(r.id), h.repo.now()).steps.find((s) => s.key === 'shared')!;
      await h.service.scan(h.token(r.id), 'gate-1', 'entry');
      const inside = states();
      h.setReal(T0 + H);
      await h.service.scan(h.token(r.id), 'gate-1', 'exit');
      const after = guestTracker(h.db, h.res(r.id), h.repo.now());
      const expected = [
        'booked:done shared:upcoming arrived:current parked:upcoming left:upcoming',
        'booked:done shared:done arrived:done parked:done left:current',
      ];
      if (before !== expected[0] || inside !== expected[1]) throw new Error(`${before} / ${inside}`);
      if (shared.state !== 'done' || !shared.detail?.includes('WhatsApp') || !shared.detail.includes('isn’t confirmed')) throw new Error('share step wrong');
      if (after.steps.some((s) => s.state !== 'done') || after.tone !== 'success') throw new Error(after.steps.map((s) => s.state).join(' '));
      // A pass handed over outside the app: once the guest is in, no "not shared yet" step.
      const unshared = await h.service.createReservation(guestInput(h, 'V-014', T0 + H, T0 + 2 * H, 'Unshared'));
      await h.service.scan(h.token(unshared.id), 'gate-1', 'entry');
      const unsharedKeys = guestTracker(h.db, h.res(unshared.id), h.repo.now()).steps.map((s) => s.key).join(' ');
      if (unsharedKeys !== 'booked arrived parked left') throw new Error(unsharedKeys);
      return 'booked → shared (not claimed as delivered) → arrived → parked → left, all from stored events';
    },
  ],
  [
    'Security’s expected arrivals cover the next hour and late guests still in grace',
    async (h) => {
      const late = await h.service.createReservation(guestInput(h, 'V-011', T0 - 10 * M, T0 + H, 'Late', 'EGY 5001'));
      const soon = await h.service.createReservation(guestInput(h, 'V-021', T0 + 40 * M, T0 + 2 * H, 'Soon', 'EGY 5002', 'prop-b1104'));
      await h.service.createReservation(guestInput(h, 'V-022', T0 + 3 * H, T0 + 4 * H, 'Later', 'EGY 5003', 'prop-b1104'));
      const inside = await h.service.createReservation(guestInput(h, 'V-014', T0, T0 + H, 'Inside', 'EGY 5004'));
      await h.service.scan(h.token(inside.id), 'gate-1', 'entry');
      const list = expectedArrivals(h.db, h.repo.now(), 60);
      const got = list.map((a) => `${a.name}:${a.phase}`).join(' ');
      if (got !== 'Late:late Soon:due' || list[0].reservationId !== late.id || list[1].reservationId !== soon.id) throw new Error(got);
      return got;
    },
  ],
  [
    'Arabic directions are written from the same route as the English ones',
    async (h) => {
      const route = h.space('EV-03').route;
      const steps = [...route.steps, route.walk!];
      const ar = steps.map((s) => stepText(s, 'ar'));
      const en = steps.map((s) => stepText(s, 'en'));
      const ok = ar.length === en.length && ar.every((t) => /[\u0600-\u06FF]/.test(t)) && ar.some((t) => t.includes('على يمينك')) && ar.some((t) => t.includes('البدروم'));
      if (!ok || en[en.length - 2] !== 'Park in EV-03, the third bay on your right') throw new Error(ar.join(' | '));
      return ar[ar.length - 2];
    },
  ],
  [
    'No pass or invitation token is stored; the link is the key, and cancelling closes it',
    async (h) => {
      const r = await h.service.createReservation(guestInput(h, 'V-012', T0 + H, T0 + 3 * H, 'منى سعيد', 'EGY 7007'));
      const raw = db().prepare("SELECT data FROM parking_credentials WHERE reservation_id = ?").get(r.id) as { data: string };
      const token = h.token(r.id);
      const invitation = h.db.invitations.find((i) => i.id === h.res(r.id).invitationId)!;
      const link = invitationToken(invitation);
      if (raw.data.includes(token) || raw.data.includes('displayToken')) throw new Error('raw token stored');
      const sealedReservation = (db().prepare('SELECT data FROM parking_reservations WHERE id = ?').get(r.id) as { data: string }).data;
      if (sealedReservation.includes('EGY 7007') || sealedReservation.includes('منى')) throw new Error('guest details stored in the clear');
      if (findInvitation(h.db, link)?.reservation.id !== r.id || findInvitation(h.db, `${link}x`)) throw new Error('link lookup wrong');
      await h.service.cancelReservation(r.id);
      if (findInvitation(h.db, link)) throw new Error('cancelled booking still opens from its link');
      const gate = await h.service.scan(token, 'gate-1', 'entry');
      if (gate.outcome !== 'rejected') throw new Error(`cancelled pass ${gate.outcome}`);
      return 'credential rows hold only hashes, guest details are sealed, the link finds only its booking and stops working on cancel';
    },
  ],
];


describe('Parking rules on the backend (the 23 acceptance checks)', () => {
  for (const [name, run] of checks) {
    test(name, async () => {
      const detail = await run(harness());
      assert.ok(detail.length > 0);
    });
  }
  test('there are 23 checks', () => assert.equal(checks.length, 23));
});
