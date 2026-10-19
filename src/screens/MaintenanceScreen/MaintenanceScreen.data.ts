import type { StatusTone } from '../../components/ui/StatusChip';
import type { IconSet } from '../../components/ui/ServiceTile';
import { formatDate } from '../VisitorAccessScreen/VisitorAccessScreen.data';

/**
 * Mock content for the Maintenance screen. Shaped the way a real API response
 * would be, so wiring this to a backend later replaces this module rather
 * than the screen. Wording matches the Figma reference
 * (assets/Screens/screen6.png) exactly.
 */

export const maintenanceCopy = {
  title: 'Maintenance',
  bannerTitle: 'Home maintenance,\nmade simple',
  bannerBody: 'Reliable support for a more\ncomfortable home.',
  categoriesTitle: 'Service Categories',
  activeTitle: 'Active Request',
  viewAll: 'View All',
  newRequest: 'New Request',
  myRequests: 'My Requests',
  emergencyTitle: 'Emergency Support',
  emergencyBody: 'For urgent issues, get immediate assistance.',
  callNow: 'Call Now',
  /*
   * Not in the design: the request form (built on Visitor Access's form) and
   * the request history behind "View All" and "My Requests".
   */
  showLess: 'Show Less',
  formTitle: 'New Maintenance Request',
  formSubtitle: 'Tell us what needs fixing and when suits you',
  submit: 'Submit Request',
  closeForm: 'Close the request form',
  historyTitle: 'My Requests',
  technicianPending: 'To be assigned',
  contactPending: 'Pending',
  submitted: (id: string) => `Request ${id} submitted`,
} as const;

export interface ServiceCategory {
  id: string;
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
}

/** Three across, read left to right: the reference's grid; "View All" adds the rest. */
export const CATEGORIES_SHOWN = 6;

export const serviceCategories: readonly ServiceCategory[] = [
  { id: 'hvac', title: 'AC / HVAC', subtitle: 'Cooling & Heating', iconSet: 'ionicons', iconName: 'snow-outline' },
  { id: 'electrical', title: 'Electrical', subtitle: 'Lights & Power', iconSet: 'ionicons', iconName: 'bulb-outline' },
  // The drawn wall tap exists in the icon sets only as a filled glyph.
  { id: 'plumbing', title: 'Plumbing', subtitle: 'Water & Drains', iconSet: 'material', iconName: 'water-pump' },
  { id: 'appliances', title: 'Appliances', subtitle: 'Home Appliances', iconSet: 'material', iconName: 'fridge-outline' },
  { id: 'doors', title: 'Doors & Locks', subtitle: 'Access & Security', iconSet: 'material', iconName: 'door' },
  {
    id: 'other',
    title: 'Other',
    subtitle: 'General Maintenance',
    iconSet: 'ionicons',
    iconName: 'ellipsis-horizontal-circle-outline',
  },
  // Behind "View All".
  { id: 'painting', title: 'Painting', subtitle: 'Walls & Ceilings', iconSet: 'material', iconName: 'format-paint' },
  { id: 'pest', title: 'Pest Control', subtitle: 'Insects & Rodents', iconSet: 'ionicons', iconName: 'bug-outline' },
  { id: 'carpentry', title: 'Carpentry', subtitle: 'Wood & Furniture', iconSet: 'ionicons', iconName: 'hammer-outline' },
];

export type RequestStatus = 'submitted' | 'assigned' | 'in-progress' | 'completed';

export const requestStatusDisplay: Record<RequestStatus, { label: string; tone: StatusTone }> = {
  submitted: { label: 'Submitted', tone: 'slate' },
  assigned: { label: 'Assigned', tone: 'slate' },
  'in-progress': { label: 'In Progress', tone: 'violet' },
  completed: { label: 'Completed', tone: 'teal' },
};

export interface RequestStage {
  status: RequestStatus;
  /** When the stage was reached; absent until it is. */
  date?: string;
  time?: string;
}

export interface MaintenanceRequest {
  id: string;
  title: string;
  unit: string;
  categoryId: ServiceCategory['id'];
  status: RequestStatus;
  /** Every stage, in order, whether reached or not. */
  stages: readonly RequestStage[];
  technician: string;
  visitDate: string;
  visitWindow: string;
  /**
   * The technician's number, as shown; dialled from the Contact column.
   * `null` until a technician is assigned.
   */
  contactPhone: string | null;
  /** What the resident added for the technician, if anything. */
  details?: string;
}

const activeRequest: MaintenanceRequest = {
  id: 'REQ-2026-00124',
  title: 'AC not cooling properly',
  unit: 'Unit A-302',
  categoryId: 'hvac',
  status: 'in-progress',
  stages: [
    { status: 'submitted', date: '05 Oct 2026', time: '10:15 AM' },
    { status: 'assigned', date: '05 Oct 2026', time: '12:30 PM' },
    { status: 'in-progress', date: '06 Oct 2026', time: '09:00 AM' },
    { status: 'completed' },
  ],
  technician: 'Ahmed Hassan',
  visitDate: '06 Oct 2026',
  visitWindow: '09:00 AM – 12:00 PM',
  contactPhone: '+20 10 9876 5432',
};

/** The resident's requests, newest first; the panel opens on the first. */
export const initialRequests: readonly MaintenanceRequest[] = [
  activeRequest,
  {
    id: 'REQ-2026-00117',
    title: 'Kitchen sink leaking',
    unit: 'Unit A-302',
    categoryId: 'plumbing',
    status: 'completed',
    stages: [
      { status: 'submitted', date: '21 Sep 2026', time: '08:40 AM' },
      { status: 'assigned', date: '21 Sep 2026', time: '10:05 AM' },
      { status: 'in-progress', date: '22 Sep 2026', time: '11:00 AM' },
      { status: 'completed', date: '22 Sep 2026', time: '01:20 PM' },
    ],
    technician: 'Mahmoud Samir',
    visitDate: '22 Sep 2026',
    visitWindow: '11:00 AM – 02:00 PM',
    contactPhone: '+20 11 2345 6789',
  },
  {
    id: 'REQ-2026-00098',
    title: 'Bedroom light flickering',
    unit: 'Unit A-302',
    categoryId: 'electrical',
    status: 'completed',
    stages: [
      { status: 'submitted', date: '28 Aug 2026', time: '07:15 PM' },
      { status: 'assigned', date: '29 Aug 2026', time: '09:30 AM' },
      { status: 'in-progress', date: '30 Aug 2026', time: '10:00 AM' },
      { status: 'completed', date: '30 Aug 2026', time: '11:10 AM' },
    ],
    technician: 'Karim Fathy',
    visitDate: '30 Aug 2026',
    visitWindow: '09:00 AM – 12:00 PM',
    contactPhone: '+20 12 3456 7890',
  },
];

export const REQUEST_STAGES: readonly RequestStatus[] = ['submitted', 'assigned', 'in-progress', 'completed'];

export type RequestFormKey = 'issue' | 'category' | 'date' | 'window' | 'details';

export type RequestForm = Record<RequestFormKey, string>;

export type RequestFormErrors = Partial<Record<RequestFormKey, string>>;

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
export const requestFieldRows: readonly (readonly RequestFieldConfig[])[] = [
  [
    {
      key: 'issue',
      label: 'Issue',
      placeholder: 'e.g. AC not cooling',
      kind: 'text',
      iconSet: 'ionicons',
      iconName: 'construct-outline',
      iconSize: 15,
    },
  ],
  [
    {
      key: 'category',
      label: 'Category',
      placeholder: 'Select category',
      kind: 'select',
      iconSet: 'ionicons',
      iconName: 'grid-outline',
      iconSize: 14,
    },
    {
      key: 'date',
      label: 'Preferred Date',
      placeholder: 'Select date',
      kind: 'select',
      iconSet: 'ionicons',
      iconName: 'calendar-outline',
      iconSize: 16,
    },
  ],
  [
    {
      key: 'window',
      label: 'Visit Window',
      placeholder: 'Select time',
      kind: 'select',
      iconSet: 'ionicons',
      iconName: 'time-outline',
      iconSize: 17,
    },
    {
      key: 'details',
      label: 'Details (Optional)',
      placeholder: 'Anything the technician should know',
      kind: 'text',
      iconSet: 'ionicons',
      iconName: 'document-text-outline',
      iconSize: 15,
    },
  ],
];

export const emptyRequestForm: RequestForm = {
  issue: '',
  category: '',
  date: '',
  window: '',
  details: '',
};

/** Technicians visit in three-hour windows across working hours. */
export const visitWindows: readonly string[] = [
  '09:00 AM – 12:00 PM',
  '12:00 PM – 03:00 PM',
  '03:00 PM – 06:00 PM',
];

/** Visits can be booked from tomorrow up to two weeks ahead. */
export function visitDateOptions(from: Date = new Date(), days = 14): string[] {
  return Array.from({ length: days }, (_, offset) =>
    formatDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset + 1)),
  );
}

/** Frontend checks only; the backend will validate again. */
export function validateRequest(form: RequestForm): RequestFormErrors {
  const errors: RequestFormErrors = {};
  if (form.issue.trim().length < 3) {
    errors.issue = 'Describe the issue in a few words';
  }
  if (!form.category) {
    errors.category = 'Choose a category';
  }
  if (!form.date) {
    errors.date = 'Choose a date';
  }
  if (!form.window) {
    errors.window = 'Choose a time';
  }
  return errors;
}

/** "10:15 AM". */
function formatTime(date: Date): string {
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${String(hours).padStart(2, '0')}:${minutes} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/**
 * A new request, submitted now and waiting for a technician. Frontend only:
 * it lives in the screen's state until a backend issues real ones, so its
 * reference simply follows the highest one so far.
 */
export function createRequest(
  form: RequestForm,
  existing: readonly MaintenanceRequest[],
  unit: string,
  now: Date = new Date(),
): MaintenanceRequest {
  const year = now.getFullYear();
  const last = existing.reduce((max, request) => {
    const number = Number.parseInt(request.id.split('-').pop() ?? '0', 10);
    return Number.isNaN(number) ? max : Math.max(max, number);
  }, 0);
  const category = serviceCategories.find((item) => item.title === form.category);
  return {
    id: `REQ-${year}-${String(last + 1).padStart(5, '0')}`,
    title: form.issue.trim(),
    unit,
    categoryId: category?.id ?? 'other',
    status: 'submitted',
    stages: REQUEST_STAGES.map((status) =>
      status === 'submitted' ? { status, date: formatDate(now), time: formatTime(now) } : { status },
    ),
    technician: maintenanceCopy.technicianPending,
    visitDate: form.date,
    visitWindow: form.window,
    contactPhone: null,
    details: form.details.trim() || undefined,
  };
}

/**
 * The emergency line "Call Now" dials. The design does not show one.
 * TODO(config): set the compound's real emergency number; until then the
 * button opens the dialer empty rather than calling a made-up number.
 */
export const emergencyPhone: string | null = null;

/** Separates the parts of a summary line, e.g. reference and unit. */
export const SEPARATOR = ' • ';

/** "tel:" link for a number as displayed, e.g. "+20 10 9876 5432". */
export function telLink(phone: string | null): string {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : 'tel:';
}
