import { emsConfig } from '../../constants/emsConfig';
import { call } from '../ems/emsApi';
import type { Appointment, BookingInput, Doctor, Patients, Slot, Specialty } from './clinic.types';

/**
 * Clinical Appointment's backend: the clinic routes on the EMS backend, with
 * the resident's EMS session (the same one Health Passport uses). Errors are
 * EmsError, whose `code` tells "slot_taken" from "consent_required".
 */

const enc = encodeURIComponent;

export const clinicApi = {
  specialties: () => call<Specialty[]>('/api/clinic/specialties'),
  doctors: (filters: { specialty?: string | null; q?: string }) => {
    const query = [filters.specialty ? `specialty=${enc(filters.specialty)}` : '', filters.q ? `q=${enc(filters.q)}` : '']
      .filter(Boolean)
      .join('&');
    return call<Doctor[]>(`/api/clinic/doctors${query ? `?${query}` : ''}`);
  },
  doctor: (id: string) => call<Doctor>(`/api/clinic/doctors/${enc(id)}`),
  availability: (id: string, days = 14) =>
    call<{ timezone: string; days: { date: string; available: number }[] }>(`/api/clinic/doctors/${enc(id)}/availability?days=${days}`),
  slots: (id: string, date: string) => call<{ date: string; timezone: string; slots: Slot[] }>(`/api/clinic/doctors/${enc(id)}/slots?date=${date}`),
  patients: () => call<Patients>('/api/clinic/patients'),
  book: (input: BookingInput) => call<Appointment>('/api/clinic/appointments', { method: 'POST', body: input }),
  myAppointments: () => call<Appointment[]>('/api/clinic/me/appointments'),
  appointment: (id: string) => call<Appointment>(`/api/clinic/me/appointments/${enc(id)}`),
  cancel: (id: string, reason?: string) => call<Appointment>(`/api/clinic/me/appointments/${enc(id)}/cancel`, { method: 'POST', body: { reason } }),
  setConsents: (id: string, consents: { share_history?: boolean; ai_consent?: boolean }) =>
    call<Appointment>(`/api/clinic/me/appointments/${enc(id)}/consents`, { method: 'PATCH', body: consents }),
};

/** A doctor's photo, served by the backend without a session (it is part of the public directory). */
export const photoSource = (path: string | null) => (path && emsConfig.url ? { uri: `${emsConfig.url}${path}` } : null);
