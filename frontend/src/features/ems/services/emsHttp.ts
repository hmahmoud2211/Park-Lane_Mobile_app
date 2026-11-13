import type { ApiErrorCode } from '../../../../../shared/contracts/errors';
import { emsConfig } from '../../../config/ems';
import { readEnvelope } from '../../../lib/http/envelope';
import { jsonRequest, timedFetch } from '../../../lib/http/request';
import { withRetry } from '../../../lib/http/retry';

/**
 * Requests to the EMS backend. Every answer is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message } }`; failures throw EmsError with the
 * backend's code, so screens can tell "hub offline" from "signed out".
 *
 * The signed-in user's token is held here (set by EmsContext) so every
 * service and hook shares one session.
 */

/** The backend's codes (shared/contracts/errors.ts), plus the app's own for requests that never got an answer. */
export type EmsErrorCode = ApiErrorCode | 'network' | 'timeout' | (string & {});

export class EmsError extends Error {
  readonly code: EmsErrorCode;
  readonly status?: number;
  /** For `invalid`: the input the backend refused, so the screen can show the message beside it. */
  readonly field?: string;

  constructor(code: EmsErrorCode, message: string, status?: number, field?: string) {
    super(message);
    this.name = 'EmsError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

/** What to tell the resident about a failed EMS request: the backend's own message when it gave one. */
export function emsErrorText(error: unknown): string {
  return error instanceof EmsError ? error.message : 'Something went wrong. Try again.';
}

let sessionToken: string | null = null;
const expiredListeners = new Set<() => void>();
const passwordChangeListeners = new Set<() => void>();

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export const getSessionToken = () => sessionToken;

/** Called when the backend rejects the stored session, so the app can sign out. */
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

/** For other clients of the same session (Health Passport) that were refused with a 401. */
export function reportSessionExpired() {
  expiredListeners.forEach((listener) => listener());
}

/**
 * Called when the backend refuses a call until the account sets its own password (an account
 * building management created or reset with a temporary one), so the app can ask for it.
 */
export function onPasswordChangeRequired(listener: () => void): () => void {
  passwordChangeListeners.add(listener);
  return () => passwordChangeListeners.delete(listener);
}

/** For other clients of the same session (Health Passport) that were refused the same way. */
export function reportPasswordChangeRequired() {
  passwordChangeListeners.forEach((listener) => listener());
}

export const isEmsConfigured = () => emsConfig.url !== '';

export interface CallInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** Send the session token (default). Sign-in and sign-up do not. */
  auth?: boolean;
  /**
   * A 401 ends the session (default). Off for a call whose 401 means something else: changing
   * the password answers 401 for a wrong current password, which must not sign the resident out.
   */
  sessionCheck?: boolean;
  /**
   * For reads that are safe to repeat: a GET that could not reach the backend is tried
   * once more after a short pause, so a moment without signal does not show an error.
   * Timeouts and the backend's own errors are never retried.
   */
  retry?: boolean;
}

export async function call<T>(path: string, init: CallInit = {}): Promise<T> {
  if (!isEmsConfigured()) {
    // The build was made without the account service's address (EXPO_PUBLIC_DEVICE_BACKEND_URL).
    throw new EmsError('not_configured', 'This version of the app can’t connect to your account.');
  }
  const useAuth = init.auth ?? true;
  if (useAuth && !sessionToken) {
    throw new EmsError('unauthorized', 'Please sign in first.');
  }
  const method = init.method ?? 'GET';
  // The session this call is made for: a refusal speaks for it, never for one started since.
  const token = useAuth ? sessionToken : null;
  const stillCurrent = () => sessionToken === token;

  const once = () =>
    timedFetch(`${emsConfig.url}${path}`, {
      init: jsonRequest(method, init.body, token),
      timeoutMs: init.timeoutMs ?? emsConfig.requestTimeoutMs,
      noAnswer: ({ timedOut }) =>
        timedOut
          ? new EmsError('timeout', 'This is taking too long. Check your internet connection and try again.')
          : new EmsError('network', 'Couldn’t connect. Check your internet connection and try again.'),
      read: async (response) => {
        const body = await readEnvelope<T>(response);
        if (!body) {
          throw new EmsError('internal', 'Something went wrong on our side. Try again in a moment.', response.status);
        }
        if (!body.ok) {
          if (body.error.code === 'unauthorized' && useAuth && (init.sessionCheck ?? true) && stillCurrent()) {
            expiredListeners.forEach((listener) => listener());
          }
          if (body.error.code === 'password_change_required' && useAuth && stillCurrent()) {
            reportPasswordChangeRequired();
          }
          throw new EmsError(body.error.code, body.error.message, response.status, body.error.field);
        }
        return body.data;
      },
    });

  if (init.retry && method === 'GET') {
    return withRetry(once, {
      retries: 1,
      delayMs: emsConfig.retryDelayMs,
      shouldRetry: (error) => error instanceof EmsError && error.code === 'network',
    });
  }
  return once();
}
