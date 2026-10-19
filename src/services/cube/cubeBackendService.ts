import { sonoffConfig } from '../../constants/sonoffConfig';
import type {
  BackendDevice,
  DeviceKey,
  SonoffLanDevice,
  SonoffRegistration,
} from '../../types/sonoff.types';

/**
 * The unit's device backend (server/ in this repo), which reaches the CUBE
 * hub for the app. The hub's password and token stay on the backend: the
 * app only sends device commands and, when registering a plug, the plug's
 * own key, which the backend needs to drive it over the LAN.
 *
 * Every answer is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
 */

export type BackendErrorCode =
  | 'not_configured'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'not_controllable'
  | 'device_unreachable'
  | 'device_not_found'
  | 'key_rejected'
  | 'unsupported_device'
  | 'public_url_missing'
  | 'mdns_unavailable'
  | 'cube_unreachable'
  | 'cube_auth'
  | 'cube_rejected'
  | 'internal';

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly status?: number;

  constructor(code: BackendErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const { backend } = sonoffConfig;

export function isBackendConfigured(): boolean {
  return backend.url !== '';
}

async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  if (!isBackendConfigured()) {
    throw new BackendError(
      'not_configured',
      'The device backend is not set up in this build (EXPO_PUBLIC_DEVICE_BACKEND_URL).',
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? backend.requestTimeoutMs);
  const forwardAbort = () => controller.abort();
  init.signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(`${backend.url}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw timedOut
        ? new BackendError('timeout', 'The device backend took too long to answer.')
        : new BackendError('network', 'Could not reach the device backend. Is the phone on your home Wi-Fi?');
    }

    const body = (await response.json().catch(() => undefined)) as Envelope<T> | undefined;
    if (!body || typeof body.ok !== 'boolean') {
      throw new BackendError('internal', `The device backend answered ${response.status}.`, response.status);
    }
    if (!body.ok) {
      throw new BackendError(body.error.code as BackendErrorCode, body.error.message, response.status);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', forwardAbort);
  }
}

export interface BackendHealth {
  cube: { reachable: boolean; message?: string };
  mdns: { listening: boolean };
  /** False until the backend knows the address the hub should send commands to. */
  registrationReady: boolean;
}

export const getBackendHealth = (signal?: AbortSignal) => call<BackendHealth>('/api/health', { signal });

export const listDevices = () => call<BackendDevice[]>('/api/devices');

export const getDevice = (id: string) => call<BackendDevice>(`/api/devices/${encodeURIComponent(id)}`);

export const setDevicePower = (id: string, on: boolean) =>
  call<BackendDevice>(`/api/devices/${encodeURIComponent(id)}/${on ? 'on' : 'off'}`, { method: 'POST' });

/**
 * Asks the backend to look for the plug's mDNS announcement on the home
 * network and, with its key, to read its state. `found: false` means it has
 * not announced itself yet.
 */
export const discoverSonoff = (deviceId: string, key: DeviceKey, signal?: AbortSignal) =>
  call<{ found: false } | { found: true; device: SonoffLanDevice }>('/api/sonoff/discover', {
    method: 'POST',
    body: { deviceId, deviceKey: key.reveal() },
    timeoutMs: backend.discoverTimeoutMs,
    signal,
  });

/**
 * Registers the plug with the hub as a third-party device the backend
 * drives. Resolves only once the hub has given it a serial number.
 */
export const registerSonoff = (deviceId: string, key: DeviceKey, name: string) =>
  call<SonoffRegistration>('/api/sonoff/devices', {
    method: 'POST',
    body: { deviceId, deviceKey: key.reveal(), name },
    timeoutMs: backend.registerTimeoutMs,
  });
