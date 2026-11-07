/** EMS accounts: POST /api/auth/register | /login | /change-password, GET /api/auth/me, POST /api/auth/assistant-token. */

/**
 * `resident` is everyone who registers in the app. `doctor` and `clinic_staff` (the clinic's
 * front desk) come from the clinic CLI and open the clinic's own routes. `admin` is building
 * management: the admin dashboard (/admin) and /api/admin/*.
 */
export type Role = 'resident' | 'doctor' | 'clinic_staff' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /**
   * True for an account an admin created (or reset) with a temporary password: until it sets its own with
   * POST /api/auth/change-password, every other call answers 403 `password_change_required`.
   */
  mustChangePassword?: boolean;
}

/** POST /api/auth/change-password: the same session stays signed in; the account's other sessions end. */
export interface ChangePassword {
  currentPassword: string;
  /** At least 10 characters, not the current password, not the email. */
  newPassword: string;
}

/** POST /api/auth/register and /api/auth/login. */
export interface SignedIn {
  user: User;
  /** A `session` bearer token for the app. */
  token: string;
}

/** POST /api/auth/logout-others: every other session of the account ends (a lost phone), with its gateway access. */
export interface SignedOutOthers {
  revoked: number;
}

/** POST /api/auth/assistant-token: a short-lived token the app hands the Parklane Assistant. */
export interface AssistantToken {
  token: string;
  /** Milliseconds since the epoch; never later than the session it came from. */
  expiresAt: number;
}
