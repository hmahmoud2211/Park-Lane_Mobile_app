/**
 * Maintenance, housekeeping and moving requests: GET | POST /api/requests, /api/requests/:id/cancel | /comments |
 * /photos (residents of the unit); /api/admin/requests…, /api/admin/technicians… (building management).
 */

export type ServiceKind = 'maintenance' | 'housekeeping' | 'moving';
export type ServiceRequestStatus = 'submitted' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface ServiceCategoryView {
  kind: ServiceKind;
  id: string;
  title: string;
}

export interface ServiceRequestEvent {
  kind: 'status' | 'comment';
  status: ServiceRequestStatus | null;
  note: string | null;
  /** Whether building management wrote it (or the resident). */
  byStaff: boolean;
  at: string;
}

export interface ServiceRequest {
  id: string;
  reference: string;
  kind: ServiceKind;
  category: string;
  categoryTitle: string;
  title: string;
  details: string | null;
  priority: 'normal' | 'urgent';
  /** The resident's wish: YYYY-MM-DD and a window like 09:00-12:00. */
  preferredDate: string;
  preferredWindow: string;
  /** Management's booking, once assigned. */
  scheduledDate: string | null;
  scheduledWindow: string | null;
  technician: { name: string; phone: string | null } | null;
  status: ServiceRequestStatus;
  createdAt: string;
  createdByMe: boolean;
  events: ServiceRequestEvent[];
  /** Two-hour signed links. */
  photos: { id: string; url: string }[];
}

export interface NewServiceRequest {
  kind: ServiceKind;
  category: string;
  title: string;
  details?: string | null;
  priority?: 'normal' | 'urgent';
  preferredDate: string;
  preferredWindow: string;
}

/** GET /api/requests/options?kind=: what the request form offers. */
export interface ServiceRequestOptions {
  kind: ServiceKind;
  categories: ServiceCategoryView[];
  /** Visit windows as HH:MM-HH:MM, in the site's time zone. */
  windows: string[];
  /** The days a visit can be asked for, YYYY-MM-DD. */
  firstDate: string;
  lastDate: string;
  /** For emergencies; the app hides the call button while it is null. */
  emergencyPhone: string | null;
  /** The compound's time zone (dates and times above are in it) and the resident's apartment. */
  timezone: string;
  unitName: string;
}

/** A technician building management keeps on record (not an app account). */
export interface Technician {
  id: string;
  name: string;
  phone: string | null;
  /** Category ids or kinds they handle, e.g. ["plumbing", "electrical"] or ["housekeeping"]. */
  trades: string[];
  active: boolean;
}

/** Building management's view of a request. */
export interface AdminServiceRequest extends Omit<ServiceRequest, 'createdByMe'> {
  unitId: string;
  unitName: string;
  technicianId: string | null;
}
