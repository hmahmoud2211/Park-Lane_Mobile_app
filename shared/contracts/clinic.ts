/**
 * The clinic, as the EMS backend sends it to residents (backend/src/routes/clinic.ts):
 * snake_case, instants in UTC ISO 8601, `date` and `time` already in the clinic's own
 * time zone. The doctors' and front desk's routes are the clinic web app's and are not
 * typed here.
 */

import type { Localized } from './health.ts';

export type { Localized };

/**
 * What the clinic pushes on the realtime channel. It says what changed, not the clinical
 * details: a client that cares fetches the current state, which stays right after a missed
 * event, a refresh or a reconnect.
 */
export type ClinicEvent =
  /** An appointment was booked or changed status. */
  | { kind: 'appointment'; appointment_id: string; doctor_id: string; status: string }
  /** A checked-in patient became the doctor's next. Once per appointment, never again on a reconnect. */
  | { kind: 'next_patient'; appointment_id: string; doctor_id: string; patient_name: string; starts_at: string }
  /** A consultation was finalized and the patient's Health Passport updated. */
  | { kind: 'consultation_final'; appointment_id: string; consultation_id: string; doctor_id: string };

export interface Specialty {
  id: string;
  name: Localized;
  doctor_count: number;
}

export interface Doctor {
  id: string;
  name: Localized;
  title: Localized | null;
  specialty: { id: string; name: Localized };
  bio: Localized | null;
  years_experience: number | null;
  consultation_minutes: number;
  fee_egp: number | null;
  languages: string[];
  /** Relative to the backend, e.g. /api/clinic/doctors/:id/photo. */
  photo_url: string | null;
  /** Weekly hours in clinic time. weekday: 0 Sunday .. 6 Saturday. */
  schedule: { weekday: number; start: string; end: string }[];
}

export type SlotState = 'available' | 'booked' | 'past';

export interface Slot {
  starts_at: string;
  ends_at: string;
  /** Clinic wall-clock time, "15:30". */
  time: string;
  state: SlotState;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'checked_in'
  | 'waiting'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export interface Appointment {
  id: string;
  doctor: Pick<Doctor, 'id' | 'name' | 'title' | 'specialty' | 'photo_url' | 'consultation_minutes'>;
  starts_at: string;
  ends_at: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  patient: { profile_id: string | null; name: string };
  reason: string | null;
  share_history: boolean;
  ai_consent: boolean;
  can_cancel: boolean;
  can_reschedule: boolean;
  can_change_consent: boolean;
  /** Set once the doctor finalized the visit: its record in Health Passport. */
  consultation_id: string | null;
  rescheduled_to: string | null;
}

/** Who the resident can book for: their Health Passport profiles. */
export interface Patients {
  health_passport: boolean;
  profiles: { id: string; name: string; relation: 'self' | 'child' | 'parent' | 'spouse' | 'other' }[];
}

export interface BookingInput {
  doctor_id: string;
  starts_at: string;
  patient_profile_id: string;
  reason: string | null;
  share_history: boolean;
  ai_consent: boolean;
  reschedule_of?: string;
}
