import type { IconBadge } from '../../components/common/AppIcon';
import type { IconSet } from '../../components/ui/ServiceTile';
import type { StatusTone } from '../../components/ui/StatusChip';

/**
 * Mock content for the Parking screen. Shaped the way a real API response
 * would be, so wiring this to a backend later replaces this module rather
 * than the screen. Wording matches the Figma reference
 * (assets/Screens/screen7.png) exactly.
 */

export const parkingCopy = {
  title: 'Parking',
  bannerTitle: 'Your parking,\nsimplified.',
  bannerBody: 'Seamless access, greater\nconvenience, a smarter\ncommunity.',
  myParkingTitle: 'My Parking',
  vehicleTitle: 'Registered Vehicle',
  guestRequestTitle: 'Guest Parking Request',
  activityTitle: 'Parking Activity',
  viewAll: 'View All',
} as const;

/** A glyph from either icon set, optionally badged with a ringed + or − (see AppIcon). */
export interface GlyphIcon {
  set: IconSet;
  name: string;
  badge?: IconBadge;
}

/** Separates the parts of a summary line, e.g. tower and level. */
export const SEPARATOR = ' • ';

/** Only the state the design shows; add others with their chip when designed. */
export type SlotStatus = 'active';

export const slotStatusDisplay: Record<SlotStatus, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'teal' },
};

export interface ParkingSlot {
  /** The bay's code, as painted on its pillar. */
  code: string;
  tower: string;
  level: string;
  status: SlotStatus;
}

export const mySlot: ParkingSlot = {
  code: 'P2-148',
  tower: 'Tower A',
  level: 'Basement 2',
  status: 'active',
};

export interface Vehicle {
  make: string;
  model: string;
  colour: string;
  /** Country that issued the plate, e.g. "Egypt". */
  plateCountry: string;
  plate: string;
}

export const myVehicle: Vehicle = {
  make: 'BMW',
  model: 'X5 xDrive',
  colour: 'Black',
  plateCountry: 'Egypt',
  plate: 'EGY 5678',
};

/** Counts for the resident's building, as the stat tiles show them. */
export interface ParkingCapacity {
  available: number;
  total: number;
  guestAvailable: number;
  guestTotal: number;
  evAvailable: number;
  evTotal: number;
}

export const capacity: ParkingCapacity = {
  available: 42,
  total: 120,
  guestAvailable: 8,
  guestTotal: 20,
  evAvailable: 6,
  evTotal: 12,
};

/** Share of the building's bays in use, 0-1: 78 of 120 is the design's 65%. */
export function occupancyOf({ available, total }: ParkingCapacity): number {
  return total > 0 ? (total - available) / total : 0;
}

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

export function parkingStats(counts: ParkingCapacity): ParkingStat[] {
  const occupancy = occupancyOf(counts);
  return [
    {
      id: 'available',
      label: 'Available\nSpaces',
      value: String(counts.available),
      total: String(counts.total),
      icon: 'parking-sign',
    },
    {
      id: 'guest',
      label: 'Guest\nParking',
      value: String(counts.guestAvailable),
      total: String(counts.guestTotal),
      icon: { set: 'ionicons', name: 'people-outline' },
    },
    {
      id: 'ev',
      label: 'EV\nCharging',
      value: String(counts.evAvailable),
      total: String(counts.evTotal),
      icon: { set: 'ionicons', name: 'flash-outline' },
    },
    {
      id: 'occupancy',
      label: 'Occupancy\nRate',
      value: `${Math.round(occupancy * 100)}%`,
      icon: { set: 'ionicons', name: 'pie-chart-outline' },
      progress: occupancy,
    },
  ];
}

/** `blue` and `violet` are the lit gradient buttons; `glass` the plain one. */
export type ActionTone = 'blue' | 'violet' | 'glass';

export interface ParkingAction {
  id: 'navigate' | 'request-guest' | 'register-vehicle';
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
    id: 'request-guest',
    label: 'Request\nGuest Parking',
    icon: { set: 'ionicons', name: 'people-outline' },
    tone: 'violet',
  },
  {
    id: 'register-vehicle',
    label: 'Register\nNew Vehicle',
    icon: { set: 'ionicons', name: 'car-outline', badge: 'add' },
    tone: 'glass',
  },
];

/** Only the state the design shows; add others with their chip when designed. */
export type GuestRequestStatus = 'approved';

export const guestRequestStatusDisplay: Record<
  GuestRequestStatus,
  { label: string; tone: StatusTone }
> = {
  approved: { label: 'Approved', tone: 'teal' },
};

export interface GuestParkingRequest {
  id: string;
  /** Display date, e.g. "05 Oct 2026". */
  date: string;
  /** Display times bounding the reservation, e.g. "02:00 PM". */
  from: string;
  to: string;
  guests: number;
  status: GuestRequestStatus;
}

export const latestGuestRequest: GuestParkingRequest = {
  id: 'GPR-2026-0311',
  date: '05 Oct 2026',
  from: '02:00 PM',
  to: '08:00 PM',
  guests: 2,
  status: 'approved',
};

export function guestsLabel(count: number): string {
  return count === 1 ? '1 Guest' : `${count} Guests`;
}

/** "02:00 PM – 08:00 PM". */
export function timeRange({ from, to }: Pick<GuestParkingRequest, 'from' | 'to'>): string {
  return `${from} – ${to}`;
}

export type ActivityKind = 'vehicle-entry' | 'guest-approval' | 'vehicle-exit';

/**
 * Each kind of event keeps its icon and status colour. Entries are drawn
 * teal; approvals and exits violet, whatever their status reads.
 */
export const activityKindDisplay: Record<
  ActivityKind,
  { title: string; icon: GlyphIcon; tone: StatusTone }
> = {
  'vehicle-entry': {
    title: 'Car Entered',
    icon: { set: 'ionicons', name: 'car-outline' },
    tone: 'teal',
  },
  'guest-approval': {
    title: 'Guest Parking Approved',
    icon: { set: 'ionicons', name: 'people-outline' },
    tone: 'violet',
  },
  'vehicle-exit': {
    title: 'Vehicle Exit Logged',
    icon: { set: 'ionicons', name: 'car-outline', badge: 'remove' },
    tone: 'violet',
  },
};

export type ActivityStatus = 'completed' | 'approved';

export const activityStatusLabel: Record<ActivityStatus, string> = {
  completed: 'Completed',
  approved: 'Approved',
};

export interface ParkingActivity {
  id: string;
  kind: ActivityKind;
  /** Whose car or guests, e.g. "My Vehicle", "Sara Lamees". */
  subject: string;
  /** The bay or the party, e.g. "P2-148", "2 Guests". */
  detail: string;
  /** Display time, e.g. "Today, 09:14 AM". */
  time: string;
  status: ActivityStatus;
}

/** Newest first, in the reference's order. */
export const recentActivity: readonly ParkingActivity[] = [
  {
    id: 'act-0914',
    kind: 'vehicle-entry',
    subject: 'My Vehicle',
    detail: mySlot.code,
    time: 'Today, 09:14 AM',
    status: 'completed',
  },
  {
    id: 'act-1030',
    kind: 'guest-approval',
    subject: 'Sara Lamees',
    detail: guestsLabel(2),
    time: 'Today, 10:30 AM',
    status: 'approved',
  },
  {
    id: 'act-2045',
    kind: 'vehicle-exit',
    subject: 'My Vehicle',
    detail: mySlot.code,
    time: 'Today, 08:45 PM',
    status: 'completed',
  },
];
