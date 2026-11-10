import type { AmenityBookingView, AmenityOptions, AmenitySlot, NewAmenityBooking } from '../../../../../shared/contracts/amenities';
import { call } from '../../ems/services/emsHttp';

/** Amenity bookings on the EMS backend (backend/src/routes/amenities.ts). */

export const getAmenities = () => call<AmenityOptions>('/api/amenities', { retry: true });

export const getAmenitySlots = (amenityId: string, date: string) =>
  call<AmenitySlot[]>(`/api/amenities/${encodeURIComponent(amenityId)}/slots?date=${encodeURIComponent(date)}`, { retry: true });

export const bookAmenity = (amenityId: string, booking: NewAmenityBooking) =>
  call<AmenityBookingView>(`/api/amenities/${encodeURIComponent(amenityId)}/bookings`, { method: 'POST', body: booking });

export const listMyBookings = () => call<AmenityBookingView[]>('/api/amenities/bookings', { retry: true });

export const cancelAmenityBooking = (id: string) =>
  call<AmenityBookingView>(`/api/amenities/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
