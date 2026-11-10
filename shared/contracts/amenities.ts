/**
 * Amenities: GET /api/amenities, GET /api/amenities/:id/slots?date=, POST /api/amenities/:id/bookings,
 * GET /api/amenities/bookings, POST /api/amenities/bookings/:id/cancel (residents);
 * /api/admin/amenities… (building management). Times are in the compound's time zone.
 */

export type AmenityCategory = 'sports' | 'leisure' | 'family';

export interface AmenityView {
  id: string;
  title: string;
  location: string;
  /** HH:MM */
  opens: string;
  closes: string;
  slotMinutes: number;
  /** People at once. */
  capacity: number;
  /** People on one booking, the resident included. */
  maxPeople: number;
  /** Booked by one apartment at a time (a court), rather than shared up to the capacity (a pool). */
  exclusive: boolean;
  categories: AmenityCategory[];
  picture: string | null;
  cancelCutoffHours: number;
  active: boolean;
}

export interface AmenityOptions {
  amenities: AmenityView[];
  /** The days that can be booked, YYYY-MM-DD. */
  firstDate: string;
  lastDate: string;
  timezone: string;
}

export interface AmenitySlot {
  /** HH:MM */
  start: string;
  end: string;
  /** Places left (shared), or 1 / 0 (exclusive). */
  left: number;
  mine: boolean;
  /** Already started or past. */
  past: boolean;
}

export interface AmenityBookingView {
  id: string;
  reference: string;
  amenityId: string;
  amenityTitle: string;
  /** YYYY-MM-DD and HH:MM in the compound's zone. */
  date: string;
  start: string;
  end: string;
  startsAt: string;
  people: number;
  status: 'booked' | 'cancelled';
  cancellable: boolean;
  bookedByMe: boolean;
}

export interface NewAmenityBooking {
  date: string;
  start: string;
  people: number;
}
