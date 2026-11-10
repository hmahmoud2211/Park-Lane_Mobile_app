import type { User } from '../ems/auth.ts';
import { requireSite, requireSiteById, requireUnit, siteSettings } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { encodeQr, qrSvgPath } from '../lib/qr.ts';
import { deleteRowsWhere, findByHash, rowsWhere } from '../repositories/parking.ts';
import { unseal } from '../ems/secrets.ts';
import { plugIn, stopChargingInTx } from './engine/charging.ts';
import { credentialToken, sha256 } from './engine/crypto.ts';
import { stepText } from './engine/i18n.ts';
import { formatRange } from './engine/time.ts';
import { findInvitation, reservationView } from './engine/selectors.ts';
import { expectedArrivals } from './engine/tracking.ts';
import { cancelReservation, editReservation, extendReservation, reassignSpace, replacePass } from './engine/reservations.ts';
import { ParkingError, type Tx } from './engine/tx.ts';
import type { ConnectorType, OccupancyState, Reservation, ScanDirection, Serviceability, Vehicle } from './engine/types.ts';
import { ParkingService } from './service.ts';
import { loadParkingDb } from './store.ts';
import { ensureIdentity, residentSnapshot } from './views.ts';

/**
 * The parking API's own checks around the rules: who may act on which booking (residents: their apartment's
 * bookings only; visitors: the one their link opens; gate staff: the compound), inputs typed as the rules expect,
 * and the rules' refusals turned into API errors (`parking_refused`, with the rule's code in `field`).
 */

const CONNECTORS: readonly ConnectorType[] = ['Type 2', 'CCS2', 'CHAdeMO', 'GB/T'];
const PLATE = /^[A-Z0-9؀-ۿ ]{2,12}$/;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

/** Runs a rule step and reports its refusals as API errors. */
function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ParkingError) {
      if (error.code === 'not-found' || error.code === 'invite-not-found') throw new ApiError('not_found', error.message);
      throw new ApiError('parking_refused', error.message, error.code);
    }
    throw error;
  }
}

const time = (value: unknown, field: string) => (typeof value === 'number' && Number.isFinite(value) ? value : invalid(field, 'Give a time in milliseconds.'));
const optionalText = (value: unknown, field: string, max: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) invalid(field, `Up to ${max} characters.`);
  return (value as string).trim();
};

function chargingOf(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const connectorType = CONNECTORS.includes(raw.connectorType as ConnectorType) ? (raw.connectorType as ConnectorType) : invalid('charging.connectorType', 'Choose a connector type.');
  return {
    connectorType,
    start: time(raw.start, 'charging.start'),
    end: time(raw.end, 'charging.end'),
    targetKwh: typeof raw.targetKwh === 'number' ? raw.targetKwh : undefined,
    targetPercent: typeof raw.targetPercent === 'number' ? raw.targetPercent : undefined,
  };
}

function guestOf(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' && raw.name.trim().length >= 2 && raw.name.trim().length <= 60 ? raw.name.trim() : invalid('guest.name', 'Give the guest\'s name (2 to 60 characters).');
  return { name, phone: optionalText(raw.phone, 'guest.phone', 20), email: optionalText(raw.email, 'guest.email', 120) };
}

interface Resident {
  user: User;
  unit: ReturnType<typeof requireUnit>;
  service: ParkingService;
}

function resident(user: User): Resident {
  const unit = requireUnit(user);
  const site = requireSite(user);
  return { user, unit, service: new ParkingService(site.id) };
}

/** The booking, if it is the resident's apartment's. */
function ownBooking(tx: Tx, unitId: string, id: string): Reservation {
  const r = tx.find('reservations', id);
  if (!r || r.propertyId !== unitId) throw new ParkingError('not-found', 'No such booking.');
  return r;
}

// ---- residents ----------------------------------------------------------------------------------------

export function parkingSnapshot(user: User, base: string) {
  const { unit } = resident(user);
  return residentSnapshot(requireSite(user).id, user, unit, base);
}

export function parkingSearch(user: User, body: Record<string, unknown>) {
  const { unit, service } = resident(user);
  const kind = body.kind === 'ev' ? 'ev' : body.kind === 'visitor' ? 'visitor' : invalid('kind', 'Use visitor or ev.');
  return service
    .search({
      propertyId: unit.id,
      kind,
      start: time(body.start, 'start'),
      end: time(body.end, 'end'),
      connectorType: CONNECTORS.includes(body.connectorType as ConnectorType) ? (body.connectorType as ConnectorType) : undefined,
      chargingStart: typeof body.chargingStart === 'number' ? body.chargingStart : undefined,
      chargingEnd: typeof body.chargingEnd === 'number' ? body.chargingEnd : undefined,
      excludeReservationId: typeof body.excludeReservationId === 'string' ? body.excludeReservationId : undefined,
    })
    .map((option) => ({ ...option, space: { id: option.space.id, label: option.space.label, zoneId: option.space.zoneId, kind: option.space.kind } }));
}

export function bookParking(user: User, body: Record<string, unknown>) {
  const { unit, service } = resident(user);
  const bookedFor = body.bookedFor === 'resident' ? 'resident' : body.bookedFor === 'guest' ? 'guest' : invalid('bookedFor', 'Use guest or resident.');
  const parkingType = body.parkingType === 'ev' ? 'ev' : body.parkingType === 'standard' ? 'standard' : invalid('parkingType', 'Use standard or ev.');
  const vehicleId = optionalText(body.vehicleId, 'vehicleId', 64);
  return guarded(() =>
    service.createReservation(
      {
        propertyId: unit.id,
        residentId: user.id,
        bookedFor,
        guest: guestOf(body.guest),
        vehiclePlate: optionalText(body.vehiclePlate, 'vehiclePlate', 12),
        vehicleId,
        parkingType,
        spaceId: typeof body.spaceId === 'string' ? body.spaceId : invalid('spaceId', 'Choose a bay.'),
        start: time(body.start, 'start'),
        end: time(body.end, 'end'),
        charging: chargingOf(body.charging),
      },
      'resident',
      (tx) => {
        ensureIdentity(tx, user, unit);
        if (vehicleId && !tx.db.vehicles.some((vehicle) => vehicle.id === vehicleId && vehicle.residentId === user.id)) throw new ParkingError('not-found', 'No such vehicle.');
      },
    ),
  );
}

type BookingAction = 'cancel' | 'replace-pass' | 'reassign' | 'share' | 'plug-in' | 'stop' | 'extend' | 'edit';

export function actOnBooking(user: User, id: string, action: BookingAction, body: Record<string, unknown>) {
  const { unit, service } = resident(user);
  return guarded(() =>
    service.run((tx) => {
      ensureIdentity(tx, user, unit);
      const r = ownBooking(tx, unit.id, id);
      const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined;
      switch (action) {
        case 'cancel':
          return cancelReservation(tx, r.id, 'resident');
        case 'replace-pass':
          return replacePass(tx, r.id);
        case 'reassign':
          return reassignSpace(tx, r.id, 'resident', typeof body.spaceId === 'string' ? body.spaceId : undefined);
        case 'share':
          tx.audit('resident', 'pass.shared', 'reservation', r.id, typeof body.channel === 'string' ? body.channel.slice(0, 20) : 'share');
          return r;
        case 'plug-in':
          return plugIn(tx, r.id, 'resident');
        case 'stop':
          return stopChargingInTx(tx, r.id, 'resident');
        case 'extend':
          return extendReservation(tx, r.id, time(body.end, 'end'), expectedVersion);
        case 'edit': {
          const edit = (body.edit ?? {}) as Record<string, unknown>;
          return editReservation(
            tx,
            r.id,
            {
              start: edit.start === undefined ? undefined : time(edit.start, 'edit.start'),
              end: edit.end === undefined ? undefined : time(edit.end, 'edit.end'),
              spaceId: typeof edit.spaceId === 'string' ? edit.spaceId : undefined,
              guest: guestOf(edit.guest),
              vehiclePlate: optionalText(edit.vehiclePlate, 'edit.vehiclePlate', 12),
              charging: chargingOf(edit.charging),
            },
            expectedVersion,
          );
        }
      }
    }),
  );
}

export function markParkingRead(user: User) {
  const { service } = resident(user);
  guarded(() => service.markRead('owner', user.id));
  return { ok: true };
}

export function myVehicles(user: User): Vehicle[] {
  const site = requireSite(user);
  return rowsWhere('vehicles', site.id, 'resident_id', user.id).map((row) => JSON.parse(unseal(row.data)) as Vehicle);
}

export function addVehicle(user: User, body: Record<string, unknown>): Vehicle {
  const { unit, service } = resident(user);
  const plate = typeof body.plate === 'string' ? body.plate.trim().toUpperCase().replace(/\s+/g, ' ') : '';
  if (!PLATE.test(plate)) invalid('plate', 'Use 2 to 12 letters and numbers for the plate.');
  const text = (value: unknown, field: string) => (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 30 ? value.trim() : invalid(field, '1 to 30 characters.'));
  let ev: Vehicle['ev'];
  if (body.ev) {
    const raw = body.ev as Record<string, unknown>;
    const connectors = Array.isArray(raw.connectors) ? raw.connectors.filter((c): c is ConnectorType => CONNECTORS.includes(c as ConnectorType)) : [];
    if (connectors.length === 0) invalid('ev.connectors', 'Choose the car\'s connector types.');
    const number = (value: unknown, field: string, max: number) => (typeof value === 'number' && value > 0 && value <= max ? value : invalid(field, `A number up to ${max}.`));
    ev = { connectors, maxAcKw: number(raw.maxAcKw, 'ev.maxAcKw', 50), maxDcKw: number(raw.maxDcKw, 'ev.maxDcKw', 400), batteryKwh: number(raw.batteryKwh, 'ev.batteryKwh', 250) };
  }
  return guarded(() =>
    service.run((tx) => {
      ensureIdentity(tx, user, unit);
      if (tx.db.vehicles.filter((vehicle) => vehicle.residentId === user.id).length >= 5) throw new ParkingError('vehicle-limit', 'Up to 5 vehicles per resident.');
      return tx.create('vehicles', 'veh', { residentId: user.id, make: text(body.make, 'make'), model: text(body.model, 'model'), colour: text(body.colour, 'colour'), plate, plateCountry: 'EG', ev });
    }),
  );
}

export function removeVehicle(user: User, vehicleId: string): { removed: boolean } {
  const site = requireSite(user);
  const own = myVehicles(user).find((vehicle) => vehicle.id === vehicleId);
  if (!own) throw new ApiError('not_found', 'No such vehicle.');
  const { db } = loadParkingDb(site.id, 'transaction');
  if (db.reservations.some((r) => r.vehicleId === vehicleId && (r.status === 'confirmed' || r.status === 'checked-in'))) {
    throw new ApiError('parking_refused', 'This vehicle has an upcoming or current booking. Cancel it first.', 'vehicle-in-use');
  }
  return { removed: deleteRowsWhere('vehicles', 'id', vehicleId) > 0 };
}

// ---- visitors -----------------------------------------------------------------------------------------

/** The compound whose invitation this is (found by the token's hash), or 404. */
function visitorService(inviteToken: string): ParkingService {
  const found = typeof inviteToken === 'string' && /^inv_[A-Za-z0-9_-]{20,40}$/.test(inviteToken) ? findByHash('invitations', sha256(inviteToken)) : undefined;
  if (!found) throw new ApiError('not_found', 'This invitation is not available.');
  return new ParkingService(found.site_id);
}

/** What the visitor's page shows: their booking only, with the QR while it can open a gate. */
export function visitorPass(inviteToken: string, nowMs = Date.now()) {
  const service = visitorService(inviteToken);
  const { db } = loadParkingDb(service.siteId, 'transaction', nowMs);
  const found = findInvitation(db, inviteToken);
  if (!found) throw new ApiError('not_found', 'This invitation is not available.');
  const view = reservationView(db, found.reservation, nowMs);
  const r = view.reservation;
  const site = requireSiteById(service.siteId);
  const settings = siteSettings(site.id);
  const live = view.credential?.status === 'active' && (r.status === 'confirmed' || r.status === 'checked-in');
  const qr = live && view.credential ? encodeQr(credentialToken(view.credential)) : null;
  const steps = view.space.route ? [...view.space.route.steps, ...(view.space.route.walk ? [view.space.route.walk] : [])].map((step) => stepText(step, 'en')) : [];
  return {
    compound: site.name,
    reference: r.reference,
    guestName: r.guest?.name ?? null,
    status: { key: view.status.key, label: view.status.label },
    when: formatRange(Date.parse(r.scheduledStart), Date.parse(r.scheduledEnd)),
    startsAt: r.scheduledStart,
    endsAt: r.scheduledEnd,
    bay: { label: view.space.label, zone: view.zone.name, level: view.zone.level },
    gate: { name: view.gate.name, description: view.gate.description },
    directions: steps,
    plate: r.vehiclePlate ?? null,
    qr: qr ? { size: qr.size + 8, path: qrSvgPath(qr) } : null,
    securityPhone: settings.managementPhone ?? settings.emergencyPhone,
    timezone: site.timezone,
  };
}

export function visitorAct(inviteToken: string, action: 'plate' | 'help' | 'plug-in' | 'stop', body: Record<string, unknown>) {
  const service = visitorService(inviteToken);
  guarded(() => {
    if (action === 'plate') {
      const plate = typeof body.plate === 'string' ? body.plate.trim().toUpperCase().replace(/\s+/g, ' ') : '';
      if (!PLATE.test(plate)) invalid('plate', 'Use 2 to 12 letters and numbers for the plate.');
      service.addVehicleFromPass(inviteToken, plate);
    } else if (action === 'help') {
      const kind = body.kind === 'space-occupied' ? 'space-occupied' : 'contact';
      service.requestHelp(inviteToken, kind, optionalText(body.message, 'message', 300));
    } else if (action === 'plug-in') service.plugInFromPass(inviteToken);
    else service.stopChargingFromPass(inviteToken);
  });
  return visitorPass(inviteToken);
}

// ---- gate staff ---------------------------------------------------------------------------------------

export function securityDesk(siteId: string, nowMs = Date.now()) {
  const site = requireSiteById(siteId);
  const service = new ParkingService(site.id);
  service.tick();
  const { db } = loadParkingDb(site.id, 'transaction', nowMs);
  const nameOf = (r: Reservation) => r.guest?.name ?? db.residents.find((person) => person.id === r.residentId)?.name ?? 'Resident';
  const unitOf = (r: Reservation) => db.properties.find((property) => property.id === r.propertyId)?.label ?? '—';
  return {
    gates: db.gates.map((gate) => ({ id: gate.id, name: gate.name, direction: gate.direction })),
    expected: expectedArrivals(db, nowMs, 120).map((arrival) => ({ ...arrival, unit: unitOf(db.reservations.find((r) => r.id === arrival.reservationId)!) })),
    inside: db.reservations
      .filter((r) => r.status === 'checked-in')
      .map((r) => ({ id: r.id, reference: r.reference, name: nameOf(r), unit: unitOf(r), plate: r.vehiclePlate ?? null, bay: db.spaces.find((s) => s.id === r.spaceId)?.label ?? '—', until: r.scheduledEnd, overdue: reservationView(db, r, nowMs).overdue })),
    upcoming: db.reservations
      .filter((r) => r.status === 'confirmed')
      .map((r) => ({ id: r.id, reference: r.reference, name: nameOf(r), unit: unitOf(r), plate: r.vehiclePlate ?? null, bay: db.spaces.find((s) => s.id === r.spaceId)?.label ?? '—', from: r.scheduledStart, until: r.scheduledEnd, needsReassignment: Boolean(r.needsReassignment) })),
    bays: db.spaces.filter((space) => space.kind !== 'resident').map((space) => ({ id: space.id, label: space.label, kind: space.kind, occupancy: space.occupancy, serviceability: space.serviceability })),
    chargers: db.chargers.map((charger) => ({ id: charger.id, label: charger.label, status: charger.status, powerKw: charger.powerKw, current: charger.current })),
    alerts: db.notifications.filter((n) => n.audience === 'operator' && !n.resolvedAt).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.at, reservationId: n.reservationId ?? null })),
  };
}

export function securityScan(siteId: string, body: Record<string, unknown>) {
  const service = new ParkingService(requireSiteById(siteId).id);
  const code = typeof body.code === 'string' ? body.code.trim().slice(0, 200) : invalid('code', 'Scan or type the pass.');
  const gateId = typeof body.gateId === 'string' ? body.gateId : invalid('gateId', 'Choose the gate.');
  const direction: ScanDirection = body.direction === 'exit' ? 'exit' : 'entry';
  return guarded(() => service.scan(code, gateId, direction));
}

type DeskAction = 'entry' | 'exit' | 'moved-out' | 'reassign' | 'stop-charging';

export function securityAct(siteId: string, reservationId: string, action: DeskAction, body: Record<string, unknown>) {
  const service = new ParkingService(requireSiteById(siteId).id);
  const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim().slice(0, 200) : undefined;
  return guarded(() => {
    switch (action) {
      case 'entry': {
        const plate = typeof body.plate === 'string' && body.plate.trim() ? body.plate.trim().toUpperCase().replace(/\s+/g, ' ') : undefined;
        if (plate && !PLATE.test(plate)) invalid('plate', 'Use 2 to 12 letters and numbers for the plate.');
        return service.operatorEntry(reservationId, typeof body.gateId === 'string' ? body.gateId : invalid('gateId', 'Choose the gate.'), reason ?? invalid('reason', 'Say why the pass was not scanned.'), plate);
      }
      case 'exit':
        return service.operatorExit(reservationId, typeof body.gateId === 'string' ? body.gateId : invalid('gateId', 'Choose the gate.'), reason ?? invalid('reason', 'Say why the pass was not scanned.'));
      case 'moved-out':
        return service.markMovedOut(reservationId, 'operator', reason);
      case 'reassign':
        return service.reassign(reservationId, 'operator', typeof body.spaceId === 'string' ? body.spaceId : undefined);
      case 'stop-charging':
        return service.stopCharging(reservationId, 'operator');
    }
  });
}

export function securitySpace(siteId: string, spaceId: string, what: 'occupancy' | 'serviceability', body: Record<string, unknown>) {
  const service = new ParkingService(requireSiteById(siteId).id);
  const note = typeof body.note === 'string' && body.note.trim().length >= 3 ? body.note.trim().slice(0, 200) : invalid('note', 'Add a short note.');
  return guarded(() => {
    if (what === 'occupancy') {
      const state = ['vacant', 'occupied', 'unknown'].includes(body.state as string) ? (body.state as OccupancyState) : invalid('state', 'Use vacant, occupied or unknown.');
      return service.setOccupancy(spaceId, state, 'operator', note);
    }
    const state = ['in-service', 'maintenance', 'out-of-service'].includes(body.state as string) ? (body.state as Serviceability) : invalid('state', 'Use in-service, maintenance or out-of-service.');
    return service.setServiceability(spaceId, state, 'operator', note);
  });
}

export function securityCharger(siteId: string, chargerId: string, action: 'fault' | 'restore') {
  const service = new ParkingService(requireSiteById(siteId).id);
  return guarded(() => (action === 'fault' ? service.faultCharger(chargerId) : service.restoreCharger(chargerId)));
}

export function securityResolve(siteId: string, notificationId: string, body: Record<string, unknown>) {
  const service = new ParkingService(requireSiteById(siteId).id);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : 'Handled at the desk';
  guarded(() => service.resolveNotification(notificationId, 'operator', note));
  return { resolved: true };
}
