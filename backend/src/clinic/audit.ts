import type { User } from '../ems/auth.ts';
import { db } from '../ems/db.ts';

/**
 * The clinic's audit trail: every booking change, check-in, access to a
 * patient's history, AI and speech request, draft save, approval and
 * addendum. Entries name the actor, the action and the ids involved; they
 * never carry clinical text, so the trail itself is not medical data.
 */

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
  | 'consultation.recording_consent'
  | 'consultation.segment_transcribed'
  | 'consultation.segment_removed'
  | 'consultation.drafted_by_ai'
  | 'consultation.draft_saved'
  | 'consultation.finalized'
  | 'consultation.viewed'
  | 'consultation.addendum'
  | 'consultation.purged'
  | 'passport.consultation_viewed';

export interface AuditEntry {
  actor: Pick<User, 'id' | 'role'> | null;
  action: AuditAction;
  appointmentId?: string | null;
  consultationId?: string | null;
  patientProfileId?: string | null;
  /** Small facts about the action (a status, a language, a count); never clinical text. */
  detail?: Record<string, string | number | boolean | null>;
}

export function audit(entry: AuditEntry): void {
  db()
    .prepare(
      `INSERT INTO clinic_audit (at, actor_id, actor_role, action, appointment_id, consultation_id, patient_profile_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      entry.actor?.id ?? null,
      entry.actor?.role ?? 'system',
      entry.action,
      entry.appointmentId ?? null,
      entry.consultationId ?? null,
      entry.patientProfileId ?? null,
      entry.detail ? JSON.stringify(entry.detail) : null,
    );
}

export interface AuditRow {
  at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: AuditAction;
  appointment_id: string | null;
  consultation_id: string | null;
  detail: Record<string, unknown> | null;
}

/** The trail for one appointment and its consultation, oldest first. */
export function auditFor(appointmentId: string): AuditRow[] {
  const rows = db()
    .prepare(
      `SELECT at, actor_id, actor_role, action, appointment_id, consultation_id, detail FROM clinic_audit
       WHERE appointment_id = ? ORDER BY id`,
    )
    .all(appointmentId) as unknown as (Omit<AuditRow, 'detail'> & { detail: string | null })[];
  return rows.map((row) => ({ ...row, detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null }));
}
