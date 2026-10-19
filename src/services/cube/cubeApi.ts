import { cubeConfig } from '../../constants/cubeConfig';
import type { AddCameraRequest, CubeDevice, CubeEnvelope } from './cube.types';

export type CubeErrorKind = 'network' | 'timeout' | 'auth' | 'unavailable' | 'rejected';

export class CubeApiError extends Error {
  readonly kind: CubeErrorKind;
  /** The hub's own `error` code, when it answered. */
  readonly code?: number;

  constructor(kind: CubeErrorKind, message: string, code?: number) {
    super(message);
    this.name = 'CubeApiError';
    this.kind = kind;
    this.code = code;
  }
}

const OPEN_API = '/open-api/v2/rest';
/** The web console's own API; used only to approve the Open API token. */
const CONSOLE_API = '/api/v1/rest';

/** The hub's error codes worth a sentence of their own. */
const ERROR_MESSAGES: Record<number, string> = {
  110001: 'The hub is already searching for Zigbee devices.',
  110009: 'The hub could not reach the camera at that address.',
  110010: 'The camera rejected the username or password.',
  110011: 'The camera stream address is not valid.',
  110012: 'The hub does not support this camera’s video format.',
  110013: 'That device is already added.',
  110015: 'The username and password do not match the ones in the stream address.',
  110017: 'The hub already has the most cameras it can take.',
  110018: 'The ESP32 camera path is not valid.',
  // Seen when the hub has no Zigbee dongle (its bridge reports zigbee_availability: false).
  210000: 'Zigbee pairing is not available: the hub has no Zigbee dongle attached.',
};

async function send<T>(
  path: string,
  init: RequestInit & { token?: string; timeoutMs?: number } = {},
): Promise<CubeEnvelope<T>> {
  const { token, timeoutMs = cubeConfig.requestTimeoutMs, headers, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${cubeConfig.httpBase}${path}`, {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        signal: controller.signal,
      });
    } catch {
      throw timedOut
        ? new CubeApiError('timeout', 'The smart home hub took too long to answer.')
        : new CubeApiError('network', 'Could not reach the smart home hub.');
    }

    const body = (await response.json().catch(() => undefined)) as CubeEnvelope<T> | undefined;
    if (!body || typeof body.error !== 'number') {
      throw new CubeApiError('unavailable', `The smart home hub answered ${response.status}.`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function fail(body: CubeEnvelope<unknown>): never {
  if (body.error === 401) {
    throw new CubeApiError('auth', 'The smart home hub did not accept the app’s access.', 401);
  }
  throw new CubeApiError(
    'rejected',
    ERROR_MESSAGES[body.error] ?? body.message ?? `The smart home hub refused (error ${body.error}).`,
    body.error,
  );
}

/**
 * Gets an Open API token the way the console's "Done" button would: ask for
 * one (the hub refuses, but records the request), sign in to the console,
 * approve that request, then ask again. Approving with nothing pending does
 * nothing, so the order matters.
 */
async function requestToken(): Promise<string> {
  if (!cubeConfig.password) {
    throw new CubeApiError('auth', 'Set EXPO_PUBLIC_CUBE_PASSWORD to connect to the smart home hub.');
  }

  const tokenPath = `${OPEN_API}/bridge/access_token?app_name=${encodeURIComponent(cubeConfig.appName)}`;
  const first = await send<{ token?: string }>(tokenPath);
  if (first.error === 0 && first.data?.token) {
    return first.data.token;
  }

  const login = await send<{ at?: string }>(`${CONSOLE_API}/bridge/login`, {
    method: 'POST',
    body: JSON.stringify({ password: cubeConfig.password }),
  });
  if (login.error !== 0 || !login.data?.at) {
    throw new CubeApiError('auth', 'The smart home hub rejected its console password.', login.error);
  }

  const approval = await send<unknown>(`${CONSOLE_API}/bridge/openapi/authorization`, {
    method: 'POST',
    token: login.data.at,
    body: JSON.stringify({ type: 'allow' }),
  });
  if (approval.error !== 0) {
    fail(approval);
  }

  const issued = await send<{ token?: string }>(tokenPath);
  if (issued.error !== 0 || !issued.data?.token) {
    fail(issued);
  }
  return issued.data.token;
}

/** Shared, so screens asking at once wait on one sign-in rather than each starting one. */
let tokenPromise: Promise<string> | null = null;

function getToken(): Promise<string> {
  tokenPromise ??= requestToken().catch((error: unknown) => {
    tokenPromise = null;
    throw error;
  });
  return tokenPromise;
}

/** An Open API call, signing in again once if the hub has dropped the token. */
async function openApi<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const token = await getToken();
    const body = await send<T>(`${OPEN_API}${path}`, { ...init, token });
    if (body.error === 0) {
      return body.data;
    }
    if (body.error === 401 && attempt === 0) {
      tokenPromise = null;
      continue;
    }
    fail(body);
  }
}

export async function getDevices(): Promise<CubeDevice[]> {
  const data = await openApi<{ device_list: CubeDevice[] }>('/devices');
  return data.device_list ?? [];
}

export async function setDevicePower(serialNumber: string, on: boolean): Promise<void> {
  await openApi(`/devices/${encodeURIComponent(serialNumber)}`, {
    method: 'PUT',
    body: JSON.stringify({ state: { power: { powerState: on ? 'on' : 'off' } } }),
  });
}

/** Zigbee devices that join while searching are added by the hub itself. */
export async function setZigbeePairing(enable: boolean): Promise<void> {
  await openApi('/devices/discovery', {
    method: 'PUT',
    body: JSON.stringify({ enable, type: 'zigbee' }),
  });
}

export async function addCamera({ name, streamUrl, protocol }: AddCameraRequest): Promise<string> {
  const data = await openApi<{ serial_number: string }>('/devices', {
    method: 'POST',
    timeoutMs: cubeConfig.addCameraTimeoutMs,
    body: JSON.stringify({
      name,
      display_category: 'camera',
      protocol,
      manufacturer: 'Generic',
      model: protocol,
      firmware_version: '1.0',
      capabilities: [
        {
          capability: 'camera-stream',
          permission: '0110',
          settings: {
            streamSetting: { type: 'object', permission: '11', value: { stream_url: streamUrl } },
          },
        },
      ],
    }),
  });
  return data.serial_number;
}
