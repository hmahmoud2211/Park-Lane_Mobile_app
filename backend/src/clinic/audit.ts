import type { User } from '../ems/auth.ts';
import { insertClinicAudit, listAppointmentAudit, type AuditAction, type ClinicAuditRow } from '../repositories/clinicAudit.ts';

/**
 * The clinic's audit trail: every booking change, check-in, access to a
 * patient's history, AI and speech request, draft save, approval and
 * addendum. Entries name the actor, the action and the ids involved; they
 * never carry clinical text, so the trail itself is not medical data.
 */

export type { AuditAction };

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
  insertClinicAudit({
    at: new Date().toISOString(),
    actorId: entry.actor?.id ?? null,
    actorRole: entry.actor?.role ?? 'system',
    action: entry.action,
    appointmentId: entry.appointmentId ?? null,
    consultationId: entry.consultationId ?? null,
    patientProfileId: entry.patientProfileId ?? null,
    detail: entry.detail ? JSON.stringify(entry.detail) : null,
  });
}

/** A row of the trail, with its details parsed. */
export type AuditRow = Omit<ClinicAuditRow, 'detail'> & { detail: Record<string, unknown> | null };

/** The trail for one appointment and its consultation, oldest first. */
export function auditFor(appointmentId: string): AuditRow[] {
  return listAppointmentAudit(appointmentId).map((row) => ({ ...row, detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null }));
}
