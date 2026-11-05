import type { ClinicEvent } from '../../../shared/contracts/clinic.ts';
import { publish } from '../ems/events.ts';
import { deskUserIds } from '../repositories/users.ts';

/** To the doctor, the front desk and the resident who booked; each sees only what their own routes allow. */
export function broadcast(event: ClinicEvent, recipients: { doctorUserId: string; residentId?: string | null }): void {
  const ids = new Set([recipients.doctorUserId, ...deskUserIds()]);
  if (recipients.residentId) ids.add(recipients.residentId);
  for (const id of ids) {
    publish(id, { type: 'clinic', ...event });
  }
}
