import type { EmsUser } from '../../types/ems.types';
import { call } from './emsHttp';

/** EMS accounts. The home (devices, rooms) is in services/home/homeApi.ts. */

export {
  EmsError,
  getSessionToken,
  isEmsConfigured,
  onSessionExpired,
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

export const getMe = () => call<{ user: EmsUser }>('/api/auth/me');

/**
 * A short-lived token for the Parklane Assistant, so it can read and control
 * this home's devices (never the account, never unlocking a door). It ends
 * with this session. `expiresAt` is milliseconds since the epoch.
 */
export const createAssistantToken = () =>
  call<{ token: string; expiresAt: number }>('/api/auth/assistant-token', { method: 'POST' });
