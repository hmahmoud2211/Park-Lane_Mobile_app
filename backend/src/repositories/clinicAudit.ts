import { db } from '../ems/db.ts';

/** The clinic_audit table: who did what to which record. Ids and action names only, never clinical text; `detail` stays JSON text here. */

export type AuditAction =
  | 'appointment.booked'
  | 'appointment.rescheduled'
  | 'appointment.status'
  | 'appointment.consent'
  | 'history.viewed'
  | 'history.summarized'
  | 'history.summary_viewed'
  | 'history.spoken'
  | 'consultation.opened'
  | 'consultation.dictated'
  | 'consultation.draft_saved'
  | 'consultation.finalized'
  | 'consultation.viewed'
  | 'consultation.addendum'
  | 'consultation.purged'
  | 'passport.consultation_viewed'
  | 'passport.shared'
  | 'passport.share_ended';

export interface ClinicAuditRow {
  at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: AuditAction;
  appointment_id: string | null;
  consultation_id: string | null;
  detail: string | null;
}

export function insertClinicAudit(entry: {
  at: string;
  actorId: string | null;
  actorRole: string;
  action: AuditAction;
  appointmentId: string | null;
  consultationId: string | null;
  patientProfileId: string | null;
  detail: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO clinic_audit (at, actor_id, actor_role, action, appointment_id, consultation_id, patient_profile_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(entry.at, entry.actorId, entry.actorRole, entry.action, entry.appointmentId, entry.consultationId, entry.patientProfileId, entry.detail);
}

/** Oldest first. */
export function listAppointmentAudit(appointmentId: string): ClinicAuditRow[] {
  return db()
    .prepare(
      `SELECT at, actor_id, actor_role, action, appointment_id, consultation_id, detail FROM clinic_audit
       WHERE appointment_id = ? ORDER BY id`,
    )
    .all(appointmentId) as unknown as ClinicAuditRow[];
}
