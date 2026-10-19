import type { IconBadge } from '../../components/common/AppIcon';
import type { IconSet } from '../../components/ui/ServiceTile';
import type { DashboardCounts } from '../../services/parking/selectors';

/**
 * Copy and presentation rules for the Parking screen. The figures themselves
 * come from the parking store (services/parking), so every count on screen
 * is derived from the same bookings, bays and chargers. Layout follows the
 * Figma reference (assets/Screens/screen7.png).
 */

export const parkingCopy = {
  title: 'Parking',
  bannerTitle: 'Your parking,\nsimplified.',
  bannerBody: 'Seamless access, greater\nconvenience, a smarter\ncommunity.',
  myParkingTitle: 'My Parking',
  vehicleTitle: 'Registered Vehicle',
  guestRequestTitle: 'Guest Parking Requests',
  guestRequestEmpty: 'No upcoming guest parking. Reserve a space and share the pass with your visitor.',
  activityTitle: 'Parking Activity',
  activityEmpty: 'Entries and exits for your bookings appear here.',
  viewAll: 'View All',
  countsNote: 'Live counts right now. When you book, availability is checked for the exact time you choose.',
} as const;

/** A glyph from either icon set, optionally badged with a ringed + or − (see AppIcon). */
export interface GlyphIcon {
  set: IconSet;
  name: string;
  badge?: IconBadge;
}

/** Separates the parts of a summary line, e.g. tower and level. */
export const SEPARATOR = ' • ';

/** The drawn parking sign, which no icon set has; everything else is a glyph. */
export type StatIcon = GlyphIcon | 'parking-sign';

export interface ParkingStat {
  id: string;
  /** Two lines, broken where the design breaks them. */
  label: string;
  value: string;
  total?: string;
  icon: StatIcon;
  /** Draws a gauge under the figure; the occupancy tile has one. */
  progress?: number;
}

/** The four tiles, each labelled with exactly what it counts. */
export function parkingStats(counts: DashboardCounts): ParkingStat[] {
  return [
    {
      id: 'available',
      label: 'Available\nnow',
      value: String(counts.sharedAvailableNow),
      total: String(counts.sharedTotal),
      icon: 'parking-sign',
    },
    {
      id: 'guest',
      label: 'Guest bays\nfree now',
      value: String(counts.guestAvailableNow),
      total: String(counts.guestTotal),
      icon: { set: 'ionicons', name: 'people-outline' },
    },
    {
      id: 'ev',
      label: 'Chargers\nfree now',
      value: String(counts.chargerFreeNow),
      total: String(counts.chargerTotal),
      icon: { set: 'ionicons', name: 'flash-outline' },
    },
    {
      id: 'occupancy',
      label: 'Occupied\nnow',
      value: `${Math.round(counts.occupancyRate * 100)}%`,
      icon: { set: 'ionicons', name: 'pie-chart-outline' },
      progress: counts.occupancyRate,
    },
  ];
}

/** `blue` and `violet` are the lit gradient buttons; `glass` the plain one. */
export type ActionTone = 'blue' | 'violet' | 'glass';

export interface ParkingAction {
  id: 'navigate' | 'reserve-guest' | 'reserve-ev';
  /** Two lines, broken where the design breaks them. */
  label: string;
  icon: GlyphIcon;
  tone: ActionTone;
}

export const parkingActions: readonly ParkingAction[] = [
  {
    id: 'navigate',
    label: 'Navigate\nto My Car',
    icon: { set: 'ionicons', name: 'navigate-outline' },
    tone: 'blue',
  },
  {
    id: 'reserve-guest',
    label: 'Reserve\nGuest Parking',
    icon: { set: 'ionicons', name: 'people-outline' },
    tone: 'violet',
  },
  {
    id: 'reserve-ev',
    label: 'Reserve\nEV Charging',
    icon: { set: 'ionicons', name: 'flash-outline' },
    tone: 'glass',
  },
];
