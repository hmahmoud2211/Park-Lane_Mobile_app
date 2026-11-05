import { entryOf, finalConsultations, type ConsultationEntry } from '../clinic/history.ts';
import { ApiError } from '../errors.ts';
import { findPatientConsultation } from '../repositories/clinicConsultations.ts';
import { profileById } from './passport.ts';

/**
 * Clinic visits as the resident reads them in Health Passport: only
 * consultations a doctor finalized, never drafts, transcripts or AI output.
 */

export interface ConsultationListing {
  id: string;
  date: string;
  doctor: ConsultationEntry['doctor'];
  chief_complaint: string;
  diagnoses: string[];
  follow_up: ConsultationEntry['note']['follow_up'];
}

/** The profile's finalized visits, newest first, for the record and the Passport home. */
export function patientConsultations(profileId: string): ConsultationListing[] {
  return finalConsultations(profileId).map((entry) => ({
    id: entry.id,
    date: entry.date,
    doctor: entry.doctor,
    chief_complaint: entry.note.chief_complaint,
    diagnoses: entry.note.diagnoses.map((diagnosis) => diagnosis.name),
    follow_up: entry.note.follow_up,
  }));
}

export interface PatientConsultation extends ConsultationEntry {
  profile_id: string | null;
  patient_name: string;
  doctor_title: string | null;
  /** The doctor who approved the record, by name. */
  approved_by: string;
}

/** One finalized visit, for the resident who booked it or who owns the patient's profile; 404 for anyone else. */
export function patientConsultation(userId: string, consultationId: string): PatientConsultation {
  const row = findPatientConsultation(consultationId);
  const ownsProfile = row?.patient_profile_id ? profileById(row.patient_profile_id)?.owner_id === userId : false;
  if (!row || !(row.booked_by === userId || ownsProfile)) {
    throw new ApiError('not_found', 'Consultation not found.');
  }
  return {
    ...entryOf(row),
    profile_id: row.patient_profile_id,
    patient_name: row.patient_name,
    doctor_title: row.title,
    approved_by: row.approved_by ?? row.display_name,
  };
}
