/** EMS accounts: POST /api/auth/register | /login, GET /api/auth/me, POST /api/auth/assistant-token. */

/**
 * `resident` is everyone who registers in the app. `doctor` and `clinic_staff` (the clinic's
 * front desk) come from the clinic CLI and open the clinic's own routes.
 */
export type Role = 'resident' | 'doctor' | 'clinic_staff';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** POST /api/auth/register and /api/auth/login. */
export interface SignedIn {
  user: User;
  /** A `session` bearer token for the app. */
  token: string;
}

/** POST /api/auth/assistant-token: a short-lived token the app hands the Parklane Assistant. */
export interface AssistantToken {
  token: string;
  /** Milliseconds since the epoch; never later than the session it came from. */
  expiresAt: number;
}
