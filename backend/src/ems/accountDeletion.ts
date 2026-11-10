import { randomUUID } from 'node:crypto';

import { transition } from '../clinic/appointments.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { sweepOrphanFiles } from '../health/files.ts';
import {
  anonymiseUserRow,
  clinicRecordsReferTo,
  deleteAccountData,
  deleteUserRow,
} from '../repositories/accountDeletion.ts';
import { listResidentAppointments } from '../repositories/clinicAppointments.ts';
import { loginOf, revokeTokens, verifyCredentials, type User } from './auth.ts';
import { forgetParkingResident } from '../parking/accounts.ts';
import { transaction } from './db.ts';
import { closeUserConnections } from './realtime.ts';

/**
 * A resident deleting their own account (App Store 5.1.1(v), Google Play's account deletion policy),
 * from the app or from the /account/delete page.
 *
 * What goes: the sign-ins, the apartment membership (and with it every health share and the gateway
 * phones), all Health Passport data with its files, invites, smart-home links, and the account's
 * name and email. Upcoming clinic visits are cancelled first, as if the resident cancelled them.
 *
 * What stays: the clinic's own record of visits that happened (the patient's name as booked and the
 * doctor's approved note), which a clinic must keep. Those rows point at the account, so when any
 * exist the users row is kept with no name, email or usable password instead of being removed.
 * The building's audit log keeps device actions, no longer linked to the account.
 *
 * Accounts for clinic staff and building management are closed by an administrator, and the shared
 * demo account cannot be deleted, so reviewers and visitors can always sign in with it.
 */

export const isDefaultAccount = (user: Pick<User, 'email'>) => {
  const username = loginOf(config.ems.defaultAccount.username);
  return Boolean(username) && user.email === username;
};

export async function deleteOwnAccount(user: User, passwordInput: unknown, nowMs = Date.now()): Promise<{ deleted: true; clinicRecordsKept: boolean }> {
  if (user.role !== 'resident') {
    throw new ApiError('forbidden', 'Clinic and building-management accounts are closed by an administrator. Ask building management.');
  }
  if (isDefaultAccount(user)) {
    throw new ApiError('forbidden', 'This is the shared demo account, so it cannot be deleted. Create your own account to try account deletion.');
  }
  await verifyCredentials(user.email, passwordInput).catch(() => {
    throw new ApiError('unauthorized', 'The password isn\'t right.');
  });

  // Nothing new can start while the rest runs.
  revokeTokens(user.id, ['session', 'assistant']);

  // Upcoming visits are freed for other patients, through the same path as a resident's own cancel,
  // so the doctor and the desk are told. Each runs its own transaction; one that changed meanwhile is skipped.
  for (const appointment of listResidentAppointments(user.id)) {
    if (appointment.status === 'scheduled' && Date.parse(appointment.starts_at) > nowMs) {
      try {
        transition({ user }, appointment.id, 'cancel', { reason: 'Account deleted' }, nowMs);
      } catch {
        // Already cancelled, started or moved by the clinic: nothing to free.
      }
    }
  }

  // Parking bookings they made that haven't started are cancelled through the parking rules (passes and visitor
  // links stop working); past ones stay as the gate's log without naming them.
  forgetParkingResident(user.id, nowMs);

  const clinicRecordsKept = transaction(() => {
    deleteAccountData(user.id);
    if (clinicRecordsReferTo(user.id)) {
      anonymiseUserRow(user.id, `deleted-${randomUUID()}@deleted.invalid`);
      return true;
    }
    deleteUserRow(user.id);
    return false;
  });

  // The documents' pages and the spoken summaries are files; the rows that named them are gone.
  sweepOrphanFiles();
  closeUserConnections(user.id);
  console.log(`EMS: account ${user.id} deleted by its owner${clinicRecordsKept ? ' (clinic visit records kept, anonymised account row)' : ''}`);
  return { deleted: true, clinicRecordsKept };
}
