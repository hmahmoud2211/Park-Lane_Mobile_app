import { emsConfig } from '../../constants/emsConfig';

/**
 * Requests to the EMS backend. Every answer is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message } }`; failures throw EmsError with the
 * backend's code, so screens can tell "hub offline" from "signed out".
 *
 * The signed-in user's token is held here (set by EmsContext) so every
 * service and hook shares one session.
 */

export type EmsErrorCode =
  | 'not_configured'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'not_available'
  | 'no_home'
  | 'provisioning'
  | 'hub_offline'
  | 'hub_auth'
  | 'ha_rejected'
  | 'internal'
  | (string & {});

export class EmsError extends Error {
  readonly code: EmsErrorCode;
  readonly status?: number;

  constructor(code: EmsErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'EmsError';
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

let sessionToken: string | null = null;
const expiredListeners = new Set<() => void>();

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export const getSessionToken = () => sessionToken;

/** Called when the backend rejects the stored session, so the app can sign out. */
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

export const isEmsConfigured = () => emsConfig.url !== '';

export async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  if (!isEmsConfigured()) {
    throw new EmsError('not_configured', 'The EMS backend is not set up in this build (EXPO_PUBLIC_DEVICE_BACKEND_URL).');
  }
  const useAuth = init.auth ?? true;
  if (useAuth && !sessionToken) {
    throw new EmsError('unauthorized', 'Sign in to your EMS account first.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? emsConfig.requestTimeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${emsConfig.url}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(useAuth && sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw timedOut
        ? new EmsError('timeout', 'The EMS backend took too long to answer.')
        : new EmsError('network', 'Could not reach the EMS backend. Check your internet connection.');
    }

    const body = (await response.json().catch(() => undefined)) as Envelope<T> | undefined;
    if (!body || typeof body.ok !== 'boolean') {
      throw new EmsError('internal', `The EMS backend answered ${response.status}.`, response.status);
    }
    if (!body.ok) {
      if (body.error.code === 'unauthorized' && useAuth) {
        expiredListeners.forEach((listener) => listener());
      }
      throw new EmsError(body.error.code, body.error.message, response.status);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
