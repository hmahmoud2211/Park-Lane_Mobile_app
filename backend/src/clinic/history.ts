import { unseal } from '../ems/secrets.ts';
import { accessTo, consentGiven, gapsFor, profileById, readSections, type Gap, type RecordSections } from '../health/passport.ts';
import { listPastVisits } from '../repositories/clinicAppointments.ts';
import { listAddendaForHistory, listFinalConsultations, type FinalConsultationRow } from '../repositories/clinicConsultations.ts';
import type { AppointmentRow } from './appointments.ts';
import type { DoctorRow, Localized } from './doctors.ts';
import type { ClinicalNote } from './note.ts';
import { ageAt, clinicDate } from './time.ts';

/**
 * What a doctor may see of a patient's history, decided in one place.
 *
 * Full access needs all of: the doctor's own appointment with the patient,
 * not cancelled; the resident's "share my Health Passport" choice for that
 * appointment; the Health Passport consent of the profile's keeper still in
 * force; a booker who is not the keeper still sharing the profile with edit
 * access; and the visit no more than ACCESS_AFTER_DAYS ago. It opens the Health
 * Passport record and every finalized clinic consultation.
 *
 * Otherwise access is limited: the patient's basic details, the reason for
 * this visit, and the consultations this doctor wrote themself.
 */

const ACCESS_AFTER_DAYS = 7;

export interface HistoryAccess {
  level: 'full' | 'limited';
  /** Why access is limited, shown to the doctor as is. */
  reason: string | null;
}

export function accessFor(appointment: AppointmentRow, nowMs = Date.now()): HistoryAccess {
  const limited = (reason: string): HistoryAccess => ({ level: 'limited', reason });
  if (appointment.status === 'cancelled' || appointment.status === 'rescheduled') {
    return limited('This appointment is no longer active.');
  }
  if (appointment.share_history !== 1) {
    return limited('The patient has not shared their Health Passport for this visit.');
  }
  const profile = appointment.patient_profile_id ? profileById(appointment.patient_profile_id) : null;
  if (!profile) return limited('The patient’s Health Passport profile no longer exists.');
  if (!consentGiven(profile.owner_id)) return limited('The patient’s Health Passport is switched off.');
  // Booked by someone the record is shared with: it was theirs to share only while it still is, to edit.
  const booker = accessTo(appointment.booked_by, profile);
  if (booker !== 'owner' && booker !== 'edit') {
    return limited('The family member who booked this visit can no longer change this Health Passport.');
  }
  if (nowMs > Date.parse(appointment.ends_at) + ACCESS_AFTER_DAYS * 24 * 3600_000) {
    return limited(`Access to the shared record ended ${ACCESS_AFTER_DAYS} days after the visit.`);
  }
  return { level: 'full', reason: null };
}

/** Where a Health Passport item came from, which tells the doctor how far to rely on it. */
export type Provenance = 'clinic_visit' | 'uploaded_document' | 'patient_entered';

export function provenanceOf(source: string | null): Provenance {
  if (!source) return 'patient_entered';
  return source.startsWith('consultation:') ? 'clinic_visit' : 'uploaded_document';
}

export interface ConsultationEntry {
  id: string;
  appointment_id: string;
  date: string;
  doctor: { id: string; name: Localized; specialty: Localized };
  note: ClinicalNote;
  finalized_at: string;
  ai_assisted: boolean;
  addenda: { text: string; created_at: string; author: string }[];
}

function addendaOf(consultationId: string): ConsultationEntry['addenda'] {
  return listAddendaForHistory(consultationId).map((row) => ({ ...row, text: unseal(row.text) }));
}

/** Finalized consultations for a patient, newest first; `doctorId` keeps only that doctor's. */
export function finalConsultations(profileId: string, doctorId: string | null = null, limit = 50): ConsultationEntry[] {
  return listFinalConsultations(profileId, doctorId, limit).map(entryOf);
}

export function entryOf(row: FinalConsultationRow): ConsultationEntry {
  return {
    id: row.id,
    appointment_id: row.appointment_id,
    date: clinicDate(Date.parse(row.starts_at)),
    doctor: {
      id: row.doctor_id,
      name: { en: row.display_name, ar: row.display_name_ar ?? row.display_name },
      specialty: { en: row.specialty_en, ar: row.specialty_ar },
    },
    note: JSON.parse(unseal(row.final)) as ClinicalNote,
    finalized_at: row.finalized_at,
    ai_assisted: row.ai_used === 1,
    addenda: addendaOf(row.id),
  };
}

export interface PastVisit {
  appointment_id: string;
  date: string;
  doctor_name: string;
  specialty: string;
  status: string;
}

function pastVisits(profileId: string, doctorId: string | null, beforeIso: string): PastVisit[] {
  return listPastVisits(profileId, doctorId, beforeIso).map((row) => ({
    appointment_id: row.id,
    date: clinicDate(Date.parse(row.starts_at)),
    doctor_name: row.display_name,
    specialty: row.name_en,
    status: row.status,
  }));
}

export interface PatientHistory {
  access: HistoryAccess;
  patient: {
    profile_id: string | null;
    name: string;
    sex: string | null;
    age: number | null;
    /** Full access only. */
    date_of_birth: string | null;
    blood_type: string | null;
  };
  /** Full access only: the Health Passport record, each item with its provenance. */
  passport: {
    record_updated_at: string;
    sections: { [S in keyof RecordSections]: (RecordSections[S][number] & { provenance: Provenance })[] };
    gaps: Gap[];
  } | null;
  consultations: ConsultationEntry[];
  past_visits: PastVisit[];
}

export function patientHistory(doctor: DoctorRow, appointment: AppointmentRow, nowMs = Date.now()): PatientHistory {
  const access = accessFor(appointment, nowMs);
  const profileId = appointment.patient_profile_id;
  const profile = profileId ? profileById(profileId) : null;
  const full = access.level === 'full' && profile !== null;
  const patient = {
    profile_id: profileId,
    name: appointment.patient_name,
    sex: appointment.patient_sex,
    age: ageAt(appointment.patient_dob, Date.parse(appointment.starts_at)),
    date_of_birth: full ? profile.date_of_birth : null,
    blood_type: full ? profile.blood_type : null,
  };
  let passport: PatientHistory['passport'] = null;
  if (full) {
    const sections = readSections(profile.id);
    passport = {
      record_updated_at: profile.record_updated_at,
      sections: Object.fromEntries(
        Object.entries(sections).map(([section, items]) => [
          section,
          items.map((item) => ({ ...item, provenance: provenanceOf(item.source) })),
        ]),
      ) as NonNullable<PatientHistory['passport']>['sections'],
      gaps: gapsFor(profile, sections, 'en'),
    };
  }
  const scopeDoctor = full ? null : doctor.id;
  return {
    access,
    patient,
    passport,
    consultations: profileId
      ? finalConsultations(profileId, scopeDoctor).filter((entry) => entry.appointment_id !== appointment.id)
      : [],
    past_visits: profileId ? pastVisits(profileId, scopeDoctor, appointment.starts_at) : [],
  };
}
