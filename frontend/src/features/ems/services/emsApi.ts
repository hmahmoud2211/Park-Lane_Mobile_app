import type { ChangePassword, SignedOutOthers } from '../../../../../shared/contracts/auth';
import type { EmsUser } from '../../../types/ems.types';
import { call } from './emsHttp';

/** EMS accounts. The home (devices, rooms) is in services/home/homeApi.ts. */

export {
  EmsError,
  getSessionToken,
  isEmsConfigured,
  onPasswordChangeRequired,
  onSessionExpired,
  reportPasswordChangeRequired,
  reportSessionExpired,
  setSessionToken,
  type EmsErrorCode,
} from './emsHttp';

// ---- Account -------------------------------------------------------------------------

interface SessionResult {
  user: EmsUser;
  token: string;
}

export const signIn = (email: string, password: string) =>
  call<SessionResult>('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });

export const createAccount = (name: string, email: string, password: string) =>
  call<SessionResult>('/api/auth/register', { method: 'POST', body: { name, email, password }, auth: false });

export const signOut = () => call<{ signedOut: true }>('/api/auth/logout', { method: 'POST' });

/**
 * For a lost phone: every other session of this account ends, and the gateway drops those
 * phones within a few minutes (its member check). This session stays.
 */
export const signOutOthers = () => call<SignedOutOthers>('/api/auth/logout-others', { method: 'POST' });

/**
 * Replaces a temporary password with the resident's own. The session stays signed in (the
 * account's other sessions end); a 401 here is a wrong current password, not a lost session.
 */
export const changePassword = (body: ChangePassword) =>
  call<{ user: EmsUser }>('/api/auth/change-password', { method: 'POST', body, sessionCheck: false });

/**
 * Deletes the signed-in account and its data on the backend (App Store 5.1.1(v), Google Play).
 * The password is asked again; a 401 here is a wrong password, not a lost session. The shared
 * demo account and staff accounts are refused (403) with a message to show.
 */
export const deleteAccount = (password: string) =>
  call<{ deleted: true; clinicRecordsKept: boolean }>('/api/auth/delete-account', { method: 'POST', body: { password }, sessionCheck: false });

export const getMe = () => call<{ user: EmsUser }>('/api/auth/me', { retry: true });

/**
 * A short-lived token for the Parklane Assistant, so it can read and control
 * this home's devices (never the account, never unlocking a door). It ends
 * with this session. `expiresAt` is milliseconds since the epoch.
 */
export const createAssistantToken = () =>
  call<{ token: string; expiresAt: number }>('/api/auth/assistant-token', { method: 'POST' });
