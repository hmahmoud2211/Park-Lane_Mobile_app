import { publish } from '../ems/events.ts';
import { deskUserIds } from '../repositories/users.ts';

/**
 * What the clinic pushes over /api/events. Events say what changed, not the
 * clinical details: a client that cares fetches the current state, which
 * keeps every screen right after a missed event, a refresh or a reconnect.
 */
export type ClinicEvent =
  /** An appointment was booked or changed status. */
  | { kind: 'appointment'; appointment_id: string; doctor_id: string; status: string }
  /**
   * A checked-in patient became the doctor's next. Sent once per
   * appointment (next_notified_at), never again on a reconnect.
   */
  | { kind: 'next_patient'; appointment_id: string; doctor_id: string; patient_name: string; starts_at: string }
  /** A consultation was finalized and the patient's Health Passport updated. */
  | { kind: 'consultation_final'; appointment_id: string; consultation_id: string; doctor_id: string };

/** To the doctor, the front desk and the resident who booked; each sees only what their own routes allow. */
export function broadcast(event: ClinicEvent, recipients: { doctorUserId: string; residentId?: string | null }): void {
  const ids = new Set([recipients.doctorUserId, ...deskUserIds()]);
  if (recipients.residentId) ids.add(recipients.residentId);
  for (const id of ids) {
    publish(id, { type: 'clinic', ...event });
  }
}
