import type Ionicons from '@expo/vector-icons/Ionicons';

import type { StatusTone } from '../../components/ui/StatusChip';
import type { IconSet } from '../../components/ui/ServiceTile';

/**
 * Mock content for the Visitor Access screen. Shaped the way a real API
 * response would be, so wiring this to a backend later replaces this module
 * rather than the screen. Wording matches the Figma reference
 * (assets/Screens/screen5.png) exactly.
 */

export type VisitorStatus = 'arrived' | 'scheduled' | 'entered';

export interface VisitorPass {
  id: string;
  name: string;
  mobile: string;
  /** Display date, e.g. "05 Oct 2026", or "Today". */
  date: string;
  /** Display time, e.g. "02:30 PM". */
  time: string;
  guests: number;
  /** Empty when the visitor is not bringing a car. */
  plate: string;
  status: VisitorStatus;
}

export const visitorAccessCopy = {
  title: 'Visitor Access',
  bannerTitle: 'Create secure\nguest entry',
  bannerBody: 'A safer, smarter community\nfor you and your guests.',
  formTitle: 'New Visitor Pass',
  formSubtitle: 'Fill in the details to generate a QR pass',
  generate: 'Generate QR Pass',
  passCaption: 'Show this QR code at the gate for a smooth entry experience.',
  upcomingTitle: 'Upcoming Visitors',
  viewAll: 'View All',
  parkingTitle: 'Guest Parking Request',
  parkingSubtitle: 'Reserve a parking slot for your visitors',
} as const;

export const statusDisplay: Record<
  VisitorStatus,
  { label: string; tone: StatusTone; icon: keyof typeof Ionicons.glyphMap }
> = {
  arrived: { label: 'Arrived', tone: 'teal', icon: 'checkmark-circle-outline' },
  scheduled: { label: 'Scheduled', tone: 'violet', icon: 'calendar-outline' },
  entered: { label: 'Entered', tone: 'slate', icon: 'log-in-outline' },
};

/**
 * The pass on show first, then the upcoming list, in the reference's order.
 * The pass card shows one of these and the list shows the rest.
 */
export const initialVisitors: readonly VisitorPass[] = [
  {
    id: 'omar-khaled',
    name: 'Omar Khaled',
    mobile: '+20 10 2233 4455',
    date: '05 Oct 2026',
    time: '02:30 PM',
    guests: 2,
    plate: 'EGY 5678',
    status: 'scheduled',
  },
  {
    id: 'sara-lamees',
    name: 'Sara Lamees',
    mobile: '+20 11 3344 5566',
    date: 'Today',
    time: '11:00 AM',
    guests: 1,
    plate: 'EGY 4321',
    status: 'arrived',
  },
  {
    id: 'mohamed-ali',
    name: 'Mohamed Ali',
    mobile: '+20 12 4455 6677',
    date: 'Today',
    time: '03:00 PM',
    guests: 3,
    plate: 'EGY 7788',
    status: 'scheduled',
  },
  {
    id: 'noura-ahmed',
    name: 'Noura Ahmed',
    mobile: '+20 10 5566 7788',
    date: '06 Oct 2026',
    time: '10:00 AM',
    guests: 2,
    plate: 'EGY 9911',
    status: 'entered',
  },
];

/** The list shows this many rows; the rest sit behind "View All". */
export const UPCOMING_LIMIT = 3;

export type FormFieldKey = 'name' | 'mobile' | 'date' | 'time' | 'guests' | 'plate';

export interface FormFieldConfig {
  key: FormFieldKey;
  label: string;
  placeholder: string;
  /** `select` fields open a list of choices instead of the keyboard. */
  kind: 'text' | 'phone' | 'select';
  iconSet: IconSet;
  iconName: string;
  /** Glyphs differ in how much of their box they fill; sized to the reference. */
  iconSize: number;
}

/** Two columns, read left to right: the reference's field grid. */
export const formFields: readonly FormFieldConfig[] = [
  {
    key: 'name',
    label: 'Visitor Name',
    placeholder: 'Enter full name',
    kind: 'text',
    iconSet: 'ionicons',
    iconName: 'person-outline',
    iconSize: 16,
  },
  {
    key: 'mobile',
    label: 'Mobile Number',
    placeholder: '+20 10 1234 5678',
    kind: 'phone',
    iconSet: 'ionicons',
    iconName: 'phone-portrait-outline',
    iconSize: 14,
  },
  {
    key: 'date',
    label: 'Visit Date',
    placeholder: 'Select date',
    kind: 'select',
    iconSet: 'ionicons',
    iconName: 'calendar-outline',
    iconSize: 16,
  },
  {
    key: 'time',
    label: 'Arrival Time',
    placeholder: 'Select time',
    kind: 'select',
    iconSet: 'ionicons',
    iconName: 'time-outline',
    iconSize: 18,
  },
  {
    key: 'guests',
    label: 'Number of Guests',
    placeholder: 'Select guests',
    kind: 'select',
    iconSet: 'ionicons',
    iconName: 'people-outline',
    iconSize: 17,
  },
  {
    key: 'plate',
    label: 'Car Plate Number (Optional)',
    placeholder: 'e.g. EGY 1234',
    kind: 'text',
    iconSet: 'ionicons',
    iconName: 'car-outline',
    iconSize: 17,
  },
];

export type VisitorForm = Record<FormFieldKey, string>;

/** Visit date and party size start filled in, as drawn. */
export const initialForm: VisitorForm = {
  name: '',
  mobile: '',
  date: '05 Oct 2026',
  time: '',
  guests: '1 Guest',
  plate: '',
};

export interface Option {
  id: string;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "05 Oct 2026". Built by hand so it reads the same on every locale. */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Visits can be booked from today up to two weeks ahead. */
export function dateOptions(from: Date = new Date(), days = 14): Option[] {
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const label = formatDate(date);
    return { id: label, label: offset === 0 ? 'Today' : label };
  });
}

/** Half-hour arrival slots across visiting hours, 08:00 AM to 10:00 PM. */
export const timeOptions: readonly Option[] = Array.from({ length: 29 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  const hours24 = Math.floor(minutes / 60);
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const label = `${String(hours12).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} ${
    hours24 < 12 ? 'AM' : 'PM'
  }`;
  return { id: label, label };
});

export function guestsLabel(count: number): string {
  return count === 1 ? '1 Guest' : `${count} Guests`;
}

export const guestOptions: readonly Option[] = Array.from({ length: 10 }, (_, index) => {
  const label = guestsLabel(index + 1);
  return { id: label, label };
});

/** Separates the parts of a visit summary, e.g. date and time. */
export const SEPARATOR = ' • ';

/** First letter of the first and last names, for the list avatars. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * What the gate scanner reads. A placeholder format: real passes should be
 * short-lived tokens issued by the backend.
 */
export function passPayload(pass: VisitorPass): string {
  return ['PARKLANE', 'VISITOR', pass.id.toUpperCase()].join(':');
}

/** Mobile numbers need at least this many digits to be dialable. */
const MIN_MOBILE_DIGITS = 8;

export type FormErrors = Partial<Record<FormFieldKey, string>>;

/** Frontend checks only; the backend will validate again. */
export function validateForm(form: VisitorForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) {
    errors.name = 'Enter the visitor’s name';
  }
  const digits = form.mobile.replace(/\D/g, '');
  if (!digits) {
    errors.mobile = 'Enter a mobile number';
  } else if (digits.length < MIN_MOBILE_DIGITS || /[^\d\s+()-]/.test(form.mobile)) {
    errors.mobile = 'Enter a valid mobile number';
  }
  if (!form.date) {
    errors.date = 'Choose a visit date';
  }
  if (!form.time) {
    errors.time = 'Choose an arrival time';
  }
  return errors;
}
