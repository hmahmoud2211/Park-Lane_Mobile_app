import type Ionicons from '@expo/vector-icons/Ionicons';

import type { ReservationView } from '../../services/parking/selectors';
import { cairoDateKey, formatRange, formatTime, relativeDayLabel } from '../../services/parking/time';
import type { AppNotification, ChargingState } from '../../services/parking/types';

/**
 * Plain-language labels for the parking screens, so residents and visitors
 * read "Charging" and "Space V-023", never record states or codes.
 */

export const chargingStateLabel: Record<ChargingState, string> = {
  reserved: 'Charging booked',
  'waiting-for-plug-in': 'Ready to plug in',
  charging: 'Charging',
  completed: 'Charging finished',
  interrupted: 'Charging stopped',
  faulted: 'Charger fault',
};

export function reservationIcon(view: ReservationView): keyof typeof Ionicons.glyphMap {
  if (view.reservation.parkingType === 'ev') return 'flash-outline';
  if (view.reservation.status === 'checked-in') return 'car-outline';
  return 'calendar-outline';
}

/**
 * "Today · 02:10 PM–05:10 PM": short enough for one line beside a status chip.
 * Without `now` (e.g. for history) it falls back to the full date.
 */
export function shortRange(start: string, end: string, now?: number): string {
  if (now === undefined) return formatRange(start, end);
  const sameDay = cairoDateKey(Date.parse(start)) === cairoDateKey(Date.parse(end));
  return `${relativeDayLabel(cairoDateKey(Date.parse(start)), now)} · ${formatTime(start)}–${formatTime(end)}${sameDay ? '' : ' (+1 day)'}`;
}

/** Two summary lines for a list row. */
export function reservationLines(view: ReservationView, now?: number): string[] {
  const r = view.reservation;
  const where = `${view.space.label} · ${view.zone.name}`;
  const lines = [shortRange(r.scheduledStart, r.scheduledEnd, now), where];
  if (r.status === 'checked-in' && r.actualEntryAt) {
    lines[1] = `${where} · in since ${formatTime(r.actualEntryAt)}`;
  }
  if (view.charging && (r.status === 'confirmed' || r.status === 'checked-in')) {
    lines.push(chargingStateLabel[view.charging.state]);
  }
  return lines;
}

export const notificationIcon: Record<AppNotification['kind'], keyof typeof Ionicons.glyphMap> = {
  overdue: 'time-outline',
  'reassignment-needed': 'swap-horizontal-outline',
  'charging-complete': 'battery-full-outline',
  'charger-fault': 'warning-outline',
  'no-show': 'person-remove-outline',
  'help-request': 'help-buoy-outline',
  entry: 'log-in-outline',
  exit: 'log-out-outline',
};
