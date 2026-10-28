import { entryOf, finalConsultations, type ConsultationEntry } from '../clinic/history.ts';
import { ApiError } from '../errors.ts';
import { db } from '../ems/db.ts';
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
  const row = db()
    .prepare(
      `SELECT c.id, c.appointment_id, c.doctor_id, c.final, c.finalized_at, c.ai_used, c.patient_profile_id,
              a.starts_at, a.booked_by, a.patient_name, d.display_name, d.display_name_ar, d.title,
              s.name_en AS specialty_en, s.name_ar AS specialty_ar, u.name AS approved_by
       FROM clinic_consultations c
       JOIN clinic_appointments a ON a.id = c.appointment_id
       JOIN clinic_doctors d ON d.id = c.doctor_id
       JOIN clinic_specialties s ON s.id = d.specialty_id
       LEFT JOIN users u ON u.id = c.finalized_by
       WHERE c.id = ? AND c.status = 'final'`,
    )
    .get(consultationId) as
    | (Parameters<typeof entryOf>[0] & {
        patient_profile_id: string | null;
        booked_by: string;
        patient_name: string;
        title: string | null;
        approved_by: string | null;
      })
    | undefined;
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
