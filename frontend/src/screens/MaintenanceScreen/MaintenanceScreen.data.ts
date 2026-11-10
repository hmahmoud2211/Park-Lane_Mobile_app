import type { StatusTone } from '../../components/ui/StatusChip';
import type { IconSet } from '../../types/icons.types';
import type { ServiceKind, ServiceRequest, ServiceRequestOptions } from '../../../../shared/contracts/serviceRequests';
import { formatClock12, formatDate } from '../../utils/format';
import { addDays, zonedDate, zonedTime } from '../../utils/zonedTime';

/**
 * The request screens: Maintenance (assets/Screens/screen6.png, whose wording this keeps), and Housekeeping and
 * Moving, which reuse its layout. Requests, categories, visit days and windows come from building management's
 * records and rules (GET /api/requests, /api/requests/options); this module turns them into what the screen shows.
 */

export type ScreenKind = ServiceKind;

export const maintenanceCopy = {
  activeTitle: 'Active Request',
  viewAll: 'View All',
  newRequest: 'New Request',
  myRequests: 'My Requests',
  emergencyTitle: 'Emergency Support',
  emergencyBody: 'For urgent issues, get immediate assistance.',
  callNow: 'Call Now',
  /* Not in the design: the form, the history, loading and empty states. */
  showLess: 'Show Less',
  formSubtitle: 'Tell us what you need and when suits you',
  submit: 'Submit Request',
  submitting: 'Sending…',
  closeForm: 'Close the request form',
  historyTitle: 'My Requests',
  technicianPending: 'To be assigned',
  contactPending: 'Pending',
  cancelRequest: 'Cancel request',
  cancelConfirm: 'Tap again to cancel this request',
  cancelFailedTitle: 'Couldn’t cancel the request',
  submitFailedTitle: 'Couldn’t send the request',
  loadFailed: 'Couldn’t load your requests',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment. You can then ask for visits here.',
  noRequests: 'No requests yet. Choose a category to ask building management for a visit.',
  submitted: (reference: string) => `Request ${reference} submitted`,
} as const;

export interface KindCopy {
  title: string;
  /** Maintenance only: the photo banner of the design. */
  banner: { title: string; body: string } | null;
  categoriesTitle: string;
  formTitle: string;
  issueLabel: string;
  issuePlaceholder: string;
  /** Categories in the reference's grid before "View All". */
  categoriesShown: number;
}

export const kindCopy: Record<ScreenKind, KindCopy> = {
  maintenance: {
    title: 'Maintenance',
    banner: { title: 'Home maintenance,\nmade simple', body: 'Reliable support for a more\ncomfortable home.' },
    categoriesTitle: 'Service Categories',
    formTitle: 'New Maintenance Request',
    issueLabel: 'Issue',
    issuePlaceholder: 'e.g. AC not cooling',
    categoriesShown: 6,
  },
  housekeeping: {
    title: 'Housekeeping',
    banner: null,
    categoriesTitle: 'Cleaning Services',
    formTitle: 'New Housekeeping Request',
    issueLabel: 'Request',
    issuePlaceholder: 'e.g. Clean before guests arrive',
    categoriesShown: 6,
  },
  moving: {
    title: 'Moving Request',
    banner: null,
    categoriesTitle: 'Moving In or Out',
    formTitle: 'New Moving Request',
    issueLabel: 'Request',
    issuePlaceholder: 'e.g. Furniture delivery',
    categoriesShown: 6,
  },
};

export interface ServiceCategory {
  id: string;
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
}

/** How each category the backend offers is drawn; a category added later gets the generic look. */
const CATEGORY_LOOK: Record<string, Omit<ServiceCategory, 'id' | 'title'>> = {
  hvac: { subtitle: 'Cooling & Heating', iconSet: 'ionicons', iconName: 'snow-outline' },
  electrical: { subtitle: 'Lights & Power', iconSet: 'ionicons', iconName: 'bulb-outline' },
  // The drawn wall tap exists in the icon sets only as a filled glyph.
  plumbing: { subtitle: 'Water & Drains', iconSet: 'material', iconName: 'water-pump' },
  appliances: { subtitle: 'Home Appliances', iconSet: 'material', iconName: 'fridge-outline' },
  doors: { subtitle: 'Access & Security', iconSet: 'material', iconName: 'door' },
  other: { subtitle: 'General Maintenance', iconSet: 'ionicons', iconName: 'ellipsis-horizontal-circle-outline' },
  painting: { subtitle: 'Walls & Ceilings', iconSet: 'material', iconName: 'format-paint' },
  pest: { subtitle: 'Insects & Rodents', iconSet: 'ionicons', iconName: 'bug-outline' },
  carpentry: { subtitle: 'Wood & Furniture', iconSet: 'ionicons', iconName: 'hammer-outline' },
  standard: { subtitle: 'Regular Cleaning', iconSet: 'material', iconName: 'broom' },
  deep: { subtitle: 'Top to Bottom', iconSet: 'material', iconName: 'spray-bottle' },
  windows: { subtitle: 'Inside & Out', iconSet: 'material', iconName: 'window-closed-variant' },
  move_in: { subtitle: 'Arriving', iconSet: 'material', iconName: 'home-import-outline' },
  move_out: { subtitle: 'Leaving', iconSet: 'material', iconName: 'home-export-outline' },
};
const GENERIC_LOOK = { subtitle: 'Request a visit', iconSet: 'ionicons', iconName: 'construct-outline' } as const;

export function categoriesFrom(options: ServiceRequestOptions | undefined): ServiceCategory[] {
  return (options?.categories ?? []).map((category) => ({ id: category.id, title: category.title, ...(CATEGORY_LOOK[category.id] ?? GENERIC_LOOK) }));
}

export const lookOf = (categoryId: string) => CATEGORY_LOOK[categoryId] ?? GENERIC_LOOK;

export type RequestStatus = 'submitted' | 'assigned' | 'in-progress' | 'completed' | 'cancelled';

export const requestStatusDisplay: Record<RequestStatus, { label: string; tone: StatusTone }> = {
  submitted: { label: 'Submitted', tone: 'slate' },
  assigned: { label: 'Assigned', tone: 'slate' },
  'in-progress': { label: 'In Progress', tone: 'violet' },
  completed: { label: 'Completed', tone: 'teal' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export interface RequestStage {
  status: RequestStatus;
  /** When the stage was reached; absent until it is. */
  date?: string;
  time?: string;
}

/** A request as the screen shows it. */
export interface MaintenanceRequest {
  /** The server's id, for cancelling. */
  id: string;
  /** REQ-2026-00001 */
  reference: string;
  title: string;
  unit: string;
  categoryId: string;
  status: RequestStatus;
  /** Every stage, in order, whether reached or not; a cancelled request ends with the cancellation. */
  stages: readonly RequestStage[];
  technician: string;
  visitDate: string;
  visitWindow: string;
  /** The technician's number, dialled from the Contact column; null until one is booked. */
  contactPhone: string | null;
  cancellable: boolean;
}

const STATUS_OF: Record<ServiceRequest['status'], RequestStatus> = {
  submitted: 'submitted',
  assigned: 'assigned',
  in_progress: 'in-progress',
  completed: 'completed',
  cancelled: 'cancelled',
};
const STAGES: readonly RequestStatus[] = ['submitted', 'assigned', 'in-progress', 'completed'];

/** "06 Oct 2026" from YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day));
}

const clock = (hhmm: string) => formatClock12(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));

/** "09:00 AM – 12:00 PM" from 09:00-12:00. */
export function windowLabel(window: string): string {
  const [from, to] = window.split('-');
  return from && to ? `${clock(from)} – ${clock(to)}` : window;
}

export function toScreenRequest(request: ServiceRequest, unitName: string, timeZone: string): MaintenanceRequest {
  const status = STATUS_OF[request.status];
  // When each stage was last reached (a request booked twice shows the later booking).
  const reached = new Map<RequestStatus, RequestStage>();
  for (const event of request.events) {
    if (event.kind !== 'status' || !event.status) continue;
    const at = Date.parse(event.at);
    const stage = STATUS_OF[event.status];
    reached.set(stage, { status: stage, date: dayLabel(zonedDate(at, timeZone)), time: clock(zonedTime(at, timeZone)) });
  }
  const stages: RequestStage[] =
    status === 'cancelled'
      ? [...STAGES.filter((stage) => reached.has(stage)).map((stage) => reached.get(stage) as RequestStage), reached.get('cancelled') ?? { status: 'cancelled' }]
      : STAGES.map((stage) => reached.get(stage) ?? { status: stage });
  return {
    id: request.id,
    reference: request.reference,
    title: request.title,
    unit: unitName,
    categoryId: request.category,
    status,
    stages,
    technician: request.technician?.name ?? maintenanceCopy.technicianPending,
    visitDate: dayLabel(request.scheduledDate ?? request.preferredDate),
    visitWindow: windowLabel(request.scheduledWindow ?? request.preferredWindow),
    contactPhone: request.technician?.phone ?? null,
    cancellable: request.status === 'submitted' || request.status === 'assigned',
  };
}

const OPEN: readonly RequestStatus[] = ['submitted', 'assigned', 'in-progress'];
export const isOpen = (request: MaintenanceRequest) => OPEN.includes(request.status);

export type RequestFormKey = 'issue' | 'category' | 'date' | 'window' | 'details';

/** Select fields hold the value the backend takes (a category id, YYYY-MM-DD, 09:00-12:00), not its label. */
export type RequestForm = Record<RequestFormKey, string>;

export type RequestFormErrors = Partial<Record<RequestFormKey, string>>;

export interface Choice {
  value: string;
  label: string;
}

export type SelectKey = Extract<RequestFormKey, 'category' | 'date' | 'window'>;

export function choicesFrom(options: ServiceRequestOptions | undefined): Record<SelectKey, readonly Choice[]> {
  if (!options) return { category: [], date: [], window: [] };
  const days: Choice[] = [];
  for (let date = options.firstDate; date <= options.lastDate && days.length < 120; date = addDays(date, 1)) {
    days.push({ value: date, label: dayLabel(date) });
  }
  return {
    category: options.categories.map((category) => ({ value: category.id, label: category.title })),
    date: days,
    window: options.windows.map((window) => ({ value: window, label: windowLabel(window) })),
  };
}

export const labelFor = (choices: readonly Choice[], value: string) => choices.find((choice) => choice.value === value)?.label ?? '';

export interface RequestFieldConfig {
  key: RequestFormKey;
  label: string;
  placeholder: string;
  /** `select` fields open a list of choices instead of the keyboard. */
  kind: 'text' | 'select';
  iconSet: IconSet;
  iconName: string;
  iconSize: number;
}

/** Rows of the form, read left to right, in Visitor Access's two-column grid. */
export function requestFieldRows(copy: KindCopy): readonly (readonly RequestFieldConfig[])[] {
  return [
    [{ key: 'issue', label: copy.issueLabel, placeholder: copy.issuePlaceholder, kind: 'text', iconSet: 'ionicons', iconName: 'construct-outline', iconSize: 15 }],
    [
      { key: 'category', label: 'Category', placeholder: 'Select category', kind: 'select', iconSet: 'ionicons', iconName: 'grid-outline', iconSize: 14 },
      { key: 'date', label: 'Preferred Date', placeholder: 'Select date', kind: 'select', iconSet: 'ionicons', iconName: 'calendar-outline', iconSize: 16 },
    ],
    [
      { key: 'window', label: 'Visit Window', placeholder: 'Select time', kind: 'select', iconSet: 'ionicons', iconName: 'time-outline', iconSize: 17 },
      { key: 'details', label: 'Details (Optional)', placeholder: 'Anything the team should know', kind: 'text', iconSet: 'ionicons', iconName: 'document-text-outline', iconSize: 15 },
    ],
  ];
}

export const emptyRequestForm: RequestForm = { issue: '', category: '', date: '', window: '', details: '' };

/** The app's own checks; the backend checks again against the compound's rules. */
export function validateRequest(form: RequestForm): RequestFormErrors {
  const errors: RequestFormErrors = {};
  if (form.issue.trim().length < 3) errors.issue = 'Describe it in a few words';
  if (!form.category) errors.category = 'Choose a category';
  if (!form.date) errors.date = 'Choose a date';
  if (!form.window) errors.window = 'Choose a time';
  return errors;
}

/** Which field a refusal from the backend belongs to. */
export function formFieldOf(apiField: string | undefined): RequestFormKey | null {
  switch (apiField) {
    case 'title':
      return 'issue';
    case 'category':
      return 'category';
    case 'preferredDate':
      return 'date';
    case 'preferredWindow':
      return 'window';
    case 'details':
      return 'details';
    default:
      return null;
  }
}

/** Separates the parts of a summary line, e.g. reference and unit. */
export const SEPARATOR = ' • ';

/** "tel:" link for a number as displayed, e.g. "+20 10 9876 5432". */
export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
