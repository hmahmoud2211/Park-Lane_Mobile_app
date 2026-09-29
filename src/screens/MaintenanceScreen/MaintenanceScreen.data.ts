import type { StatusTone } from '../../components/ui/StatusChip';
import type { IconSet } from '../../components/ui/ServiceTile';

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
} as const;

export interface ServiceCategory {
  id: string;
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
}

/** Three across, read left to right: the reference's grid. */
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
  /** The technician's number, as shown; dialled from the Contact column. */
  contactPhone: string;
}

export const activeRequest: MaintenanceRequest = {
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
