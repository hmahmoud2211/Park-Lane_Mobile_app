import { emsConfig } from '../../constants/emsConfig';
import type { AlexaStatus, EmsUser, LgAppliance, SmartDevice, SmartDeviceType } from '../../types/ems.types';

/**
 * The EMS backend's REST API. Every answer is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message } }`; failures throw EmsError with the
 * backend's code, so screens can tell "device offline" from "signed out".
 *
 * The signed-in user's token is held here (set by EmsAuthContext) so the
 * SONOFF wizard and hooks share one session.
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
  | 'device_offline'
  | 'device_unreachable'
  | 'device_not_found'
  | 'command_timeout'
  | 'key_rejected'
  | 'unsupported_device'
  | 'mdns_unavailable'
  | 'amazon_error'
  | 'link_expired'
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

async function call<T>(
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

// ---- Devices -------------------------------------------------------------------------

export const listDevices = () => call<SmartDevice[]>('/api/devices');

export interface NewVirtualDevice {
  name: string;
  room?: string;
  type: SmartDeviceType;
}

export const addVirtualDevice = (device: NewVirtualDevice) =>
  call<SmartDevice>('/api/devices', { method: 'POST', body: { ...device, protocol: 'virtual' } });

/** Adds a device that is on the CUBE hub; the app and Alexa then switch it through the hub. */
export const addCubeDevice = (input: { name: string; room?: string; serial: string }) =>
  call<SmartDevice>('/api/devices', {
    method: 'POST',
    body: { name: input.name, room: input.room, type: 'plug', protocol: 'cube', cube: { serial: input.serial } },
    timeoutMs: emsConfig.registerTimeoutMs,
  });

/** LG appliances the backend's rethink bridge knows; `connected` is false while it cannot reach rethink. */
export const listLgAppliances = () => call<{ connected: boolean; appliances: LgAppliance[] }>('/api/lg/appliances');

/** Adds an LG appliance paired with rethink; the app and Alexa then switch it through the backend. */
export const addLgAppliance = (input: { name: string; room?: string; applianceId: string }) =>
  call<SmartDevice>('/api/devices', {
    method: 'POST',
    body: { name: input.name, room: input.room, type: 'ac', protocol: 'rethink', lg: { applianceId: input.applianceId } },
    timeoutMs: emsConfig.registerTimeoutMs,
  });

export type DeviceChanges = Partial<Pick<SmartDevice, 'name' | 'room' | 'alexaEnabled' | 'isDefault' | 'online'>>;

export const updateDevice = (id: string, changes: DeviceChanges) =>
  call<SmartDevice>(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });

export const removeDevice = (id: string) =>
  call<{ deleted: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Resolves with the state the device confirmed; throws if it did not. */
export const setDevicePower = (id: string, power: 'on' | 'off') =>
  call<SmartDevice>(`/api/devices/${encodeURIComponent(id)}/power`, { method: 'POST', body: { power } });

// ---- Alexa -----------------------------------------------------------------------------

export const getAlexaStatus = (refresh = false) =>
  call<AlexaStatus>(`/api/integrations/alexa/status${refresh ? '?refresh=1' : ''}`);

export const startAlexaLink = () =>
  call<{ url: string; expiresAt: string }>('/api/integrations/alexa/link/start', { method: 'POST' });

export const unlinkAlexa = () =>
  call<AlexaStatus & { amazonConfirmed: boolean }>('/api/integrations/alexa/unlink', { method: 'POST' });
