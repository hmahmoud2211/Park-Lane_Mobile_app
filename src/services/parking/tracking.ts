/**
 * Following a guest's visit, from records the demo already keeps: the
 * booking, the owner sharing the pass, gate scans, bay occupancy, charging
 * and the exit. Nothing here is stored; it is all read back from those
 * records at a clock reading, so the owner's tracker and the security
 * console always agree with the gate log.
 */
import { isOverdue } from './availability';
import { projectSession } from './charging';
import { MINUTE_MS, formatDateTime, formatDuration, formatTime, ms } from './time';
import type { ParkingDb, Reservation } from './types';

/** How the owner handed the pass on. None of these confirms delivery. */
export type ShareChannel = 'whatsapp' | 'share' | 'copy';

export const shareChannelLabel: Record<ShareChannel, string> = {
  whatsapp: 'WhatsApp',
  share: 'the share menu',
  copy: 'a copied link',
};

export type TrackState = 'done' | 'current' | 'upcoming' | 'problem';

export interface TrackStep {
  key: 'booked' | 'shared' | 'arrived' | 'parked' | 'left' | 'ended';
  title: string;
  detail?: string;
  state: TrackState;
  /** An Ionicons glyph. */
  icon: string;
}

export interface GuestTracker {
  /** One line on where things stand now. */
  headline: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  steps: TrackStep[];
}

const gateShort = (db: ParkingDb, id: string | undefined) => db.gates.find((g) => g.id === id)?.name.split(' · ')[0] ?? 'the gate';

const minutesBetween = (a: number, b: number) => Math.round(Math.abs(a - b) / MINUTE_MS);

/** The milestones of one visit, and a headline for where it stands now. */
export function guestTracker(db: ParkingDb, r: Reservation, now: number): GuestTracker {
  const space = db.spaces.find((s) => s.id === r.spaceId)!;
  const zone = db.zones.find((z) => z.id === space.zoneId);
  const start = ms(r.scheduledStart);
  const end = ms(r.scheduledEnd);
  const opensAt = start - db.policy.earlyArrivalMinutes * MINUTE_MS;
  const holdUntil = start + db.policy.lateArrivalGraceMinutes * MINUTE_MS;
  const who = r.guest?.name ?? 'Your vehicle';
  const steps: TrackStep[] = [];

  const created = db.audit.find((a) => a.entityId === r.id && a.action === 'reservation.created');
  steps.push({
    key: 'booked',
    title: 'Booked',
    detail: `${formatDateTime(created?.at ?? r.createdAt)} · ${space.label}`,
    state: 'done',
    icon: 'calendar-outline',
  });

  if (r.bookedFor === 'guest') {
    const shares = db.audit.filter((a) => a.entityId === r.id && a.action === 'pass.shared');
    const last = shares[shares.length - 1];
    const channel = last?.details as ShareChannel | undefined;
    if (last && channel) {
      steps.push({
        key: 'shared',
        title: 'Pass shared',
        detail: `Through ${shareChannelLabel[channel] ?? channel} at ${formatTime(last.at)}. Delivery isn’t confirmed.`,
        state: 'done',
        icon: 'paper-plane-outline',
      });
    } else if (r.status === 'confirmed') {
      // Only worth saying before the visit: a guest who came in had the pass somehow.
      steps.push({
        key: 'shared',
        title: 'Pass not shared yet',
        detail: 'Send it on WhatsApp from this page.',
        state: 'upcoming',
        icon: 'paper-plane-outline',
      });
    }
  }

  if (r.status === 'cancelled') {
    steps.push({ key: 'ended', title: 'Cancelled', detail: formatDateTime(r.cancelledAt ?? r.updatedAt), state: 'problem', icon: 'close-circle-outline' });
    return { headline: 'Cancelled. The pass no longer works.', tone: 'info', steps };
  }
  if (r.status === 'no-show') {
    steps.push({
      key: 'ended',
      title: 'Didn’t arrive',
      detail: `The booking expired at ${formatTime(r.noShowAt ?? holdUntil)}, ${db.policy.lateArrivalGraceMinutes} minutes after the booked arrival.`,
      state: 'problem',
      icon: 'person-remove-outline',
    });
    return { headline: `${who} didn’t arrive.`, tone: 'warning', steps };
  }

  // Arrival at the gate.
  let headline: string;
  let tone: GuestTracker['tone'] = 'info';
  if (r.actualEntryAt) {
    const entered = ms(r.actualEntryAt);
    const early = entered < start;
    const offset = minutesBetween(entered, start);
    steps.push({
      key: 'arrived',
      title: `Arrived at ${gateShort(db, r.entryGateId)}`,
      detail: `${formatTime(entered)}${offset >= 1 ? ` · ${offset} min ${early ? 'early' : 'late'}` : ' · on time'}`,
      state: 'done',
      icon: 'enter-outline',
    });
  } else if (now < opensAt) {
    steps.push({
      key: 'arrived',
      title: 'Expected to arrive',
      detail: `${formatTime(start)} at ${gateShort(db, space.gateId)} · the gate opens for them at ${formatTime(opensAt)}`,
      state: 'current',
      icon: 'enter-outline',
    });
  } else if (now <= start) {
    steps.push({
      key: 'arrived',
      title: 'Expected now',
      detail: `${gateShort(db, space.gateId)} lets them in from now · due ${formatTime(start)}`,
      state: 'current',
      icon: 'enter-outline',
    });
  } else {
    steps.push({
      key: 'arrived',
      title: 'Running late',
      detail: `${minutesBetween(now, start)} min late · the bay is held until ${formatTime(holdUntil)}`,
      state: 'problem',
      icon: 'enter-outline',
    });
  }

  // In the bay.
  const charging = db.chargingSessions.find((s) => s.reservationId === r.id);
  const chargingNote =
    charging && charging.state !== 'reserved'
      ? ` · ${charging.state === 'charging' ? `charging, ${projectSession(db, charging, now).energyKwh} kWh so far` : charging.state === 'waiting-for-plug-in' ? 'not plugged in yet' : `charging ended, ${charging.energyKwh} kWh`}`
      : '';
  const overdue = isOverdue(r, now);
  if (r.status === 'checked-in' || r.status === 'completed') {
    if (r.bayVacatedAt) {
      steps.push({
        key: 'parked',
        title: `Parked in ${space.label}`,
        detail: `Left the bay at ${formatTime(r.bayVacatedAt)}${chargingNote}`,
        state: 'done',
        icon: 'car-outline',
      });
    } else if (overdue) {
      steps.push({
        key: 'parked',
        title: `Still in ${space.label}`,
        detail: `Booked until ${formatTime(end)} · ${formatDuration((now - end) / MINUTE_MS)} over${chargingNote}`,
        state: 'problem',
        icon: 'car-outline',
      });
    } else {
      steps.push({
        key: 'parked',
        title: `Parked in ${space.label}`,
        detail: `${zone?.name}, ${zone?.level} · since ${formatTime(r.actualEntryAt!)}${chargingNote}`,
        state: 'done',
        icon: 'car-outline',
      });
    }
  } else {
    steps.push({
      key: 'parked',
      title: `Park in ${space.label}`,
      detail: `${zone?.name}, ${zone?.level}`,
      state: 'upcoming',
      icon: 'car-outline',
    });
  }

  // Leaving.
  if (r.actualExitAt) {
    steps.push({
      key: 'left',
      title: `Left by ${gateShort(db, r.exitGateId)}`,
      detail: formatTime(r.actualExitAt),
      state: 'done',
      icon: 'exit-outline',
    });
  } else {
    steps.push({
      key: 'left',
      title: 'Leaves',
      detail: `Booked until ${formatTime(end)}`,
      state: r.status === 'checked-in' && !overdue ? 'current' : 'upcoming',
      icon: 'exit-outline',
    });
  }

  if (r.status === 'completed') {
    headline = `${who} left at ${formatTime(r.actualExitAt!)}.`;
    tone = 'success';
  } else if (r.status === 'checked-in') {
    headline = overdue ? `${who} is still parked, past the booked time.` : `${who} is on site, in ${space.label}.`;
    tone = overdue ? 'error' : 'success';
  } else if (now > start) {
    headline = `${who} is running late.`;
    tone = 'warning';
  } else {
    headline = `${who} is expected at ${formatTime(start)}.`;
  }
  if (r.needsReassignment && r.status === 'confirmed') {
    headline = `${headline} The bay needs changing.`;
    tone = 'warning';
  }
  return { headline, tone, steps };
}

/* ------------------------------------------------------- Expected arrivals */

export type ArrivalPhase = 'due' | 'open' | 'late';

export interface ExpectedArrival {
  reservationId: string;
  name: string;
  plate?: string;
  spaceLabel: string;
  zoneName: string;
  gateId: string;
  start: number;
  phase: ArrivalPhase;
  /** "Due in 25 min · gate opens 1:30 PM". */
  when: string;
  /** The booking needs another bay before they arrive. */
  needsBay: boolean;
  ev: boolean;
}

/**
 * Bookings security should expect: those due within `lookaheadMinutes`, and
 * any already late but still inside their grace period. Soonest first.
 */
export function expectedArrivals(db: ParkingDb, now: number, lookaheadMinutes = 60): ExpectedArrival[] {
  const { earlyArrivalMinutes, lateArrivalGraceMinutes } = db.policy;
  return db.reservations
    .filter((r) => r.status === 'confirmed')
    .map((r) => ({ r, start: ms(r.scheduledStart) }))
    .filter(({ start }) => start <= now + lookaheadMinutes * MINUTE_MS && now <= start + lateArrivalGraceMinutes * MINUTE_MS)
    .sort((a, b) => a.start - b.start)
    .map(({ r, start }) => {
      const space = db.spaces.find((s) => s.id === r.spaceId)!;
      const zone = db.zones.find((z) => z.id === space.zoneId);
      const opensAt = start - earlyArrivalMinutes * MINUTE_MS;
      const phase: ArrivalPhase = now < opensAt ? 'due' : now <= start ? 'open' : 'late';
      const when =
        phase === 'due'
          ? `Due in ${formatDuration((start - now) / MINUTE_MS)} · entry opens ${formatTime(opensAt)}`
          : phase === 'open'
            ? `Entry open · due ${formatTime(start)}`
            : `${formatDuration((now - start) / MINUTE_MS)} late · held until ${formatTime(start + lateArrivalGraceMinutes * MINUTE_MS)}`;
      const vehicle = db.vehicles.find((v) => v.id === r.vehicleId);
      return {
        reservationId: r.id,
        name: r.guest?.name ?? (vehicle ? `Resident · ${vehicle.make} ${vehicle.model}` : 'Resident'),
        plate: r.vehiclePlate,
        spaceLabel: space.label,
        zoneName: zone?.name ?? '',
        gateId: space.gateId,
        start,
        phase,
        when,
        needsBay: Boolean(r.needsReassignment),
        ev: r.parkingType === 'ev',
      };
    });
}
