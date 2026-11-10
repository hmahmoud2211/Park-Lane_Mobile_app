import { db } from '../ems/db.ts';

/**
 * The SQL behind deleting one's own account (ems/accountDeletion.ts). Each statement removes or
 * anonymises one kind of personal data the account holds. The caller runs them in one transaction.
 */

/** Everything personal that belongs to the account itself, except the users row. */
export function deleteAccountData(userId: string): void {
  const database = db();
  // Health Passport: the profiles the account keeps (their items, documents, summaries and shares
  // go with them by ON DELETE CASCADE), the records others shared with it, and its consent.
  // Clinic appointments keep their own copy of the patient's name (patient_profile_id is SET NULL).
  database.prepare('DELETE FROM health_profiles WHERE owner_id = ?').run(userId);
  database.prepare('DELETE FROM health_shares WHERE user_id = ?').run(userId);
  database.prepare('DELETE FROM health_consents WHERE user_id = ?').run(userId);
  // The apartment: leaving it ends every health share through the unit_members triggers, and the
  // apartment's gateway drops the account's phones at its next member sync.
  database.prepare('DELETE FROM unit_members WHERE user_id = ?').run(userId);
  database.prepare('DELETE FROM unit_invites WHERE created_by = ?').run(userId);
  database.prepare('UPDATE unit_invites SET used_by = NULL WHERE used_by = ?').run(userId);
  // Brand-account pairings in progress. (The old devices, oauth_codes, alexa_links and link_states
  // tables were dropped by an earlier migration.)
  database.prepare('DELETE FROM pairing_sessions WHERE user_id = ?').run(userId);
  // Device actions (e.g. a door unlocked) stay in the building's audit log, no longer linked to anyone.
  database.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(userId);
  // Every sign-in, including the assistant's tokens.
  database.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId);
}

/** Whether clinic records still point at the account (as the person who booked a visit). */
export function clinicRecordsReferTo(userId: string): boolean {
  return db().prepare('SELECT 1 FROM clinic_appointments WHERE booked_by = ? LIMIT 1').get(userId) !== undefined;
}

export function deleteUserRow(userId: string): void {
  db().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

/**
 * Keeps the row only so the clinic's records stay valid (clinic_appointments.booked_by), with nothing
 * that identifies the person: no email, no name, and a password hash no password can match.
 */
export function anonymiseUserRow(userId: string, placeholderEmail: string): void {
  db()
    .prepare("UPDATE users SET email = ?, name = 'Deleted account', password_hash = '!deleted', must_change_password = 0 WHERE id = ?")
    .run(placeholderEmail, userId);
}
