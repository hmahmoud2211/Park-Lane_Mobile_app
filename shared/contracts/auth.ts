/** EMS accounts: POST /api/auth/register | /login, GET /api/auth/me, POST /api/auth/assistant-token. */

export interface User {
  id: string;
  email: string;
  name: string;
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
