import type Ionicons from '@expo/vector-icons/Ionicons';

import type { StatusTone } from '../../components/ui/StatusChip';
import type { IconSet } from '../../types/icons.types';
import type { SiteSettings } from '../../../../shared/contracts/sites';
import type { VisitorPass as ApiVisitorPass, VisitorPassStatus } from '../../../../shared/contracts/visitors';
import { formatClock12, formatDate, guestsLabel } from '../../utils/format';
import { addDays, zonedDate, zonedTime } from '../../utils/zonedTime';

/**
 * The Visitor Access screen's copy and how it reads the unit's passes (GET /api/visitors) and the compound's
 * visiting rules (GET /api/sites/me). Wording matches the Figma reference (assets/Screens/screen5.png).
 */

export type VisitorStatus = VisitorPassStatus;

/** A pass as the screen draws it. */
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
  /** What the QR holds; the gate checks it online. */
  code: string;
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
  parkingTitle: 'Reserve Guest Parking',
  parkingSubtitle: 'Reserve a parking slot for your visitors',
  /** Not in the design: the list's link once it shows everyone. */
  showLess: 'Show Less',
  /** Not in the design: the pass card's options menu and its PDF. */
  sharePass: 'Share pass',
  cancelPass: 'Cancel pass',
  passDocumentTitle: 'Visitor Pass',
  shareFailedTitle: "Couldn't share the pass",
  shareFailedBody: 'Please try again in a moment.',
  /** Not in the design: states of the list and the form. */
  noPasses: 'No visitors yet. Passes you make appear here.',
  loadFailed: 'Couldn’t load your visitors',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment, then you can invite visitors.',
  creating: 'Creating pass…',
  createFailedTitle: 'Couldn’t create the pass',
  cancelFailedTitle: 'Couldn’t cancel the pass',
} as const;

export const statusDisplay: Record<
  VisitorStatus,
  { label: string; tone: StatusTone; icon: keyof typeof Ionicons.glyphMap }
> = {
  arrived: { label: 'Arrived', tone: 'teal', icon: 'checkmark-circle-outline' },
  scheduled: { label: 'Scheduled', tone: 'violet', icon: 'calendar-outline' },
  left: { label: 'Left', tone: 'slate', icon: 'log-out-outline' },
  expired: { label: 'Expired', tone: 'slate', icon: 'time-outline' },
  revoked: { label: 'Cancelled', tone: 'slate', icon: 'close-circle-outline' },
};

/** The server's pass, as the screen draws it, with dates on the compound's clock. */
export function toScreenPass(pass: ApiVisitorPass, timeZone: string, nowMs = Date.now()): VisitorPass {
  const arrives = Date.parse(pass.arrivesAt);
  const date = zonedDate(arrives, timeZone);
  const [hours, minutes] = zonedTime(arrives, timeZone).split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  return {
    id: pass.id,
    name: pass.visitorName,
    mobile: pass.visitorPhone ?? '',
    date: date === zonedDate(nowMs, timeZone) ? 'Today' : formatDate(new Date(year, month - 1, day)),
    time: formatClock12(hours, minutes),
    guests: pass.guests,
    plate: pass.plate ?? '',
    status: pass.status,
    code: pass.code,
  };
}

/** Upcoming and present visitors first, soonest first; then the rest of the last week. */
export function orderPasses(passes: readonly ApiVisitorPass[]): ApiVisitorPass[] {
  const live = (pass: ApiVisitorPass) => pass.status === 'scheduled' || pass.status === 'arrived';
  return [...passes].sort((a, b) => Number(live(b)) - Number(live(a)) || (live(a) ? a.arrivesAt.localeCompare(b.arrivesAt) : b.arrivesAt.localeCompare(a.arrivesAt)));
}

/**
 * The pass on show first, then the upcoming list, in the reference's order.
 * The pass card shows one of these and the list shows the rest.
 */

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

/**
 * The form's values. Text fields hold what was typed; the pickers hold their option's id (a YYYY-MM-DD day, an
 * HH:MM time, a guest count), never the label shown, so "Today" is never mistaken for a date.
 */
export type VisitorForm = Record<FormFieldKey, string>;

/** Visit date (today) and party size start filled in, as drawn. */
export function initialForm(today: string): VisitorForm {
  return { name: '', mobile: '', date: today, time: '', guests: '1', plate: '' };
}

export interface Option {
  id: string;
  label: string;
}

export type VisitorRules = SiteSettings['visitors'];

/** Today's rules in the app until the compound's arrive (the backend's defaults). */
export const DEFAULT_RULES: VisitorRules = { earliest: '08:00', latest: '22:00', stepMinutes: 30, windowDays: 14, maxGuests: 10, retentionDays: 90 };

/** From today, on the compound's clock, for as many days as the compound allows. */
export function dateOptions(rules: VisitorRules, timeZone: string, nowMs = Date.now()): Option[] {
  const today = zonedDate(nowMs, timeZone);
  return Array.from({ length: rules.windowDays }, (_, offset) => {
    const id = addDays(today, offset);
    const [year, month, day] = id.split('-').map(Number);
    return { id, label: offset === 0 ? 'Today' : formatDate(new Date(year, month - 1, day)) };
  });
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Arrival slots across the compound's visiting hours; today's start at the next slot from now. */
export function timeOptions(rules: VisitorRules, date: string, timeZone: string, nowMs = Date.now()): Option[] {
  const first = toMinutes(rules.earliest);
  const last = toMinutes(rules.latest);
  const isToday = date === zonedDate(nowMs, timeZone);
  const now = isToday ? toMinutes(zonedTime(nowMs, timeZone)) : -1;
  const options: Option[] = [];
  for (let minutes = first; minutes <= last; minutes += rules.stepMinutes) {
    if (minutes < now) continue;
    const id = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    options.push({ id, label: formatClock12(Math.floor(minutes / 60), minutes % 60) });
  }
  return options;
}

export function guestOptions(rules: VisitorRules): Option[] {
  return Array.from({ length: rules.maxGuests }, (_, index) => ({ id: String(index + 1), label: guestsLabel(index + 1) }));
}

/** The label a picker shows for the value it holds. */
export const labelFor = (options: readonly Option[], id: string) => options.find((option) => option.id === id)?.label ?? '';

/** Which field a refusal from the backend belongs beside (its `field`). */
export function formFieldOf(apiField: string | undefined): FormFieldKey | null {
  switch (apiField) {
    case 'visitorName':
      return 'name';
    case 'visitorPhone':
      return 'mobile';
    case 'arrivesAt':
      return 'time';
    case 'guests':
      return 'guests';
    case 'plate':
      return 'plate';
    default:
      return null;
  }
}

/** Separates the parts of a visit summary, e.g. date and time. */
export const SEPARATOR = ' • ';

/** First letter of the first and last names, for the list avatars. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
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
