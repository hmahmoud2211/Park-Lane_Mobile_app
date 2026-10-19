import type { PolicySettings } from '../../services/parking/policy';
import { MINUTE_MS, cairoDateKey, cairoMinuteOfDay, cairoToUtc, ms } from '../../services/parking/time';
import type { ConnectorType, ParkingDb, Reservation } from '../../services/parking/types';

/** Two steps: what and when, then where (and confirm). */
export type Step = 'details' | 'space';
export const STEPS: readonly Step[] = ['details', 'space'];

export const stepTitles: Record<Step, string> = {
  details: 'Visit details',
  space: 'Choose a space',
};

export const reserveCopy = {
  guestTitle: 'Reserve Guest Parking',
  evTitle: 'Reserve EV Charging',
  editTitle: 'Edit Reservation',
  chooseTitle: 'Choose a space',
  noSpace: 'No bay is free for the whole time',
  noSpaceDetail: 'Try another time or date.',
  autoConfirm: 'Confirmed instantly if the space is still free for your whole visit when you confirm.',
  evDeparture:
    'Parking ends 15 minutes after charging by default. Book longer if you need the bay: it stays reserved for the whole stay.',
  estimateNote:
    'Charging times are estimates: they depend on how fast the car accepts charge, the charger’s capacity and slower charging near full.',
  vehicleLater: 'Visitor will add vehicle details',
  vehicleLaterDetail: 'They add the plate from their pass. Entry needs it.',
  addContact: 'Add mobile or email (optional)',
} as const;

/** Quick choices for the length of a visitor stay, in minutes. */
export const STAY_PRESETS = [60, 120, 180, 240, 360, 480] as const;

/** Bays listed before "Show more". */
export const LIST_PREVIEW = 3;

export const CONNECTORS: readonly ConnectorType[] = ['Type 2', 'CCS2', 'CHAdeMO', 'GB/T'];
export const ENERGY_TARGETS = ['none', '10', '20', '30', '40'] as const;

export interface ReserveForm {
  propertyId: string;
  bookedFor: 'guest' | 'resident';
  parkingType: 'standard' | 'ev';
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  plate: string;
  visitorAddsVehicle: boolean;
  vehicleId: string | null;
  /** Cairo calendar date of arrival. */
  dateKey: string;
  /** Minutes after Cairo midnight. */
  arrivalMin: number;
  /** Length of the parking stay. */
  stayMin: number;
  /** EV only: charging start, minutes after arrival, and its length. */
  chargeOffsetMin: number;
  chargeMin: number;
  /** Departure follows the charging end until the user moves it. */
  stayFollowsCharging: boolean;
  connectorType: ConnectorType | null;
  targetKwh: (typeof ENERGY_TARGETS)[number];
  spaceId: string | null;
}

/** The next booking slot at or after `now`. */
export function nextSlot(now: number, policy: PolicySettings): number {
  const slot = policy.slotMinutes * MINUTE_MS;
  return Math.ceil(now / slot) * slot;
}

export function startOf(form: ReserveForm): number {
  return cairoToUtc(form.dateKey, form.arrivalMin);
}

export function endOf(form: ReserveForm): number {
  return startOf(form) + form.stayMin * MINUTE_MS;
}

export function chargingWindow(form: ReserveForm) {
  const start = startOf(form) + form.chargeOffsetMin * MINUTE_MS;
  return { start, end: start + form.chargeMin * MINUTE_MS };
}

export function initialForm(
  db: ParkingDb,
  now: number,
  mode: 'guest' | 'ev',
  propertyIds: string[],
  editing?: Reservation,
): ReserveForm {
  const policy = db.policy;
  if (editing) {
    const allocation = db.allocations.find((a) => a.id === editing.chargingAllocationId);
    const connector = db.connectors.find((c) => c.id === allocation?.connectorId);
    const start = ms(editing.scheduledStart);
    return {
      propertyId: editing.propertyId,
      bookedFor: editing.bookedFor,
      parkingType: editing.parkingType,
      guestName: editing.guest?.name ?? '',
      guestPhone: editing.guest?.phone ?? '',
      guestEmail: editing.guest?.email ?? '',
      plate: editing.vehiclePlate ?? '',
      visitorAddsVehicle: !editing.vehiclePlate,
      vehicleId: editing.vehicleId ?? null,
      dateKey: cairoDateKey(start),
      arrivalMin: cairoMinuteOfDay(start),
      stayMin: Math.round((ms(editing.scheduledEnd) - start) / MINUTE_MS),
      chargeOffsetMin: allocation ? Math.round((ms(allocation.start) - start) / MINUTE_MS) : 0,
      chargeMin: allocation ? Math.round((ms(allocation.end) - ms(allocation.start)) / MINUTE_MS) : 120,
      stayFollowsCharging: false,
      connectorType: connector?.type ?? null,
      targetKwh: allocation?.targetKwh ? (String(allocation.targetKwh) as ReserveForm['targetKwh']) : 'none',
      spaceId: editing.spaceId,
    };
  }
  const slot = nextSlot(now, policy);
  const isEv = mode === 'ev';
  return {
    propertyId: propertyIds[0] ?? '',
    bookedFor: isEv ? 'resident' : 'guest',
    parkingType: isEv ? 'ev' : 'standard',
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    plate: '',
    visitorAddsVehicle: false,
    vehicleId: null,
    dateKey: cairoDateKey(slot),
    arrivalMin: cairoMinuteOfDay(slot),
    stayMin: isEv ? 120 + policy.evMoveOutBufferMinutes : 180,
    chargeOffsetMin: 0,
    chargeMin: 120,
    stayFollowsCharging: true,
    connectorType: null,
    targetKwh: 'none',
    spaceId: null,
  };
}
