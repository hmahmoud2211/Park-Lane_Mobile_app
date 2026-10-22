import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';

/**
 * The CUBE hub's Open API v2 (cubeOS 2.14), as documented at
 * https://cube.ewelink.cc/resources/developer-and-api-guide. Its credentials
 * live here and nowhere in the app.
 */

export interface CubeCapability {
  capability: string;
  permission: string;
  name?: string;
}

export interface CubeDevice {
  serial_number: string;
  third_serial_number?: string;
  name: string;
  manufacturer: string;
  model: string;
  display_category: string;
  capabilities: CubeCapability[];
  state?: { power?: { powerState?: 'on' | 'off' } } & Record<string, unknown>;
  online: boolean;
}

interface Envelope<T> {
  error: number;
  data: T;
  message?: string;
}

const OPEN_API = '/open-api/v2/rest';
/** The web console's API; used only to approve this backend's Open API token. */
const CONSOLE_API = '/api/v1/rest';

async function send(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${config.cube.url}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      signal: AbortSignal.timeout(config.cube.timeoutMs),
    });
  } catch {
    throw new ApiError('cube_unreachable', `Could not reach the CUBE hub at ${config.cube.url}.`);
  }
  const body = await response.json().catch(() => undefined);
  if (body === undefined) {
    throw new ApiError('cube_unreachable', `The CUBE hub answered ${response.status} without JSON.`);
  }
  return body;
}

function envelope<T>(body: unknown): Envelope<T> {
  const value = body as Envelope<T>;
  if (!value || typeof value.error !== 'number') {
    throw new ApiError('cube_rejected', 'The CUBE hub sent an answer the backend does not understand.');
  }
  return value;
}

/**
 * The Docker build of CUBE has no link button, so the backend approves its
 * own token the way the console's "Done" button would: ask (refused, but
 * recorded), sign in to the console, approve, ask again.
 */
async function requestToken(): Promise<string> {
  if (config.cube.token) {
    return config.cube.token;
  }
  if (!config.cube.password) {
    throw new ApiError('cube_auth', 'Set CUBE_PASSWORD or CUBE_TOKEN in the backend’s .env.');
  }
  const tokenPath = `${OPEN_API}/bridge/access_token?app_name=${encodeURIComponent(config.cube.appName)}`;
  const first = envelope<{ token?: string }>(await send(tokenPath));
  if (first.error === 0 && first.data?.token) {
    return first.data.token;
  }
  const login = envelope<{ at?: string }>(
    await send(`${CONSOLE_API}/bridge/login`, {
      method: 'POST',
      body: JSON.stringify({ password: config.cube.password }),
    }),
  );
  if (login.error !== 0 || !login.data?.at) {
    throw new ApiError('cube_auth', 'The CUBE hub rejected its console password.');
  }
  const approval = envelope<unknown>(
    await send(`${CONSOLE_API}/bridge/openapi/authorization`, {
      method: 'POST',
      token: login.data.at,
      body: JSON.stringify({ type: 'allow' }),
    }),
  );
  if (approval.error !== 0) {
    throw new ApiError('cube_auth', `The CUBE hub did not approve the backend (error ${approval.error}).`);
  }
  const issued = envelope<{ token?: string }>(await send(tokenPath));
  if (issued.error !== 0 || !issued.data?.token) {
    throw new ApiError('cube_auth', `The CUBE hub did not issue a token (error ${issued.error}).`);
  }
  return issued.data.token;
}

let tokenPromise: Promise<string> | null = null;

function getToken(): Promise<string> {
  tokenPromise ??= requestToken().catch((error: unknown) => {
    tokenPromise = null;
    throw error;
  });
  return tokenPromise;
}

/** An Open API call in the `{ error, data }` envelope, signing in again once on a 401. */
async function openApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const token = await getToken();
    const body = envelope<T>(await send(`${OPEN_API}${path}`, { ...init, token }));
    if (body.error === 0) {
      return body.data;
    }
    if (body.error === 401 && attempt === 0 && !config.cube.token) {
      tokenPromise = null;
      continue;
    }
    if (body.error === 401) {
      throw new ApiError('cube_auth', 'The CUBE hub did not accept the backend’s token.');
    }
    throw new ApiError('cube_rejected', body.message || `The CUBE hub refused (error ${body.error}).`);
  }
}

/** Unauthenticated, so it answers even before the backend has a token. */
export async function getBridgeInfo(): Promise<{ name?: string; fw_version?: string }> {
  return envelope<{ name?: string; fw_version?: string }>(await send(`${OPEN_API}/bridge`)).data ?? {};
}

export async function getDevices(): Promise<CubeDevice[]> {
  const data = await openApi<{ device_list?: CubeDevice[] }>('/devices');
  return data.device_list ?? [];
}

export async function getDevice(serial: string): Promise<CubeDevice | null> {
  return (await getDevices()).find((device) => device.serial_number === serial) ?? null;
}

/** For a third-party device the hub forwards this to its service address, and fails if that does. */
export async function setPower(serial: string, on: boolean): Promise<void> {
  await openApi(`/devices/${encodeURIComponent(serial)}`, {
    method: 'PUT',
    body: JSON.stringify({ state: { power: { powerState: on ? 'on' : 'off' } } }),
  });
}

/**
 * `POST /thirdparty/event`. Its answers come as `{ header, payload }` (per
 * the docs) or as the usual `{ error, data }` envelope; both are handled.
 */
async function thirdPartyEvent<T>(event: {
  name: string;
  version: string;
  endpoint?: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Promise<T> {
  const token = await getToken();
  const body = (await send(`${OPEN_API}/thirdparty/event`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      event: {
        header: { name: event.name, message_id: randomUUID(), version: event.version },
        ...(event.endpoint ? { endpoint: event.endpoint } : {}),
        payload: event.payload,
      },
    }),
  })) as {
    header?: { name?: string };
    payload?: { description?: string; type?: string } & Record<string, unknown>;
    error?: number;
    data?: unknown;
    message?: string;
  };

  if (body.header?.name === 'ErrorResponse') {
    throw new ApiError(
      'cube_rejected',
      `The CUBE hub refused: ${body.payload?.description ?? body.payload?.type ?? 'no reason given'}.`,
    );
  }
  if (typeof body.error === 'number' && body.error !== 0) {
    throw new ApiError(
      body.error === 401 ? 'cube_auth' : 'cube_rejected',
      body.message || `The CUBE hub refused (error ${body.error}).`,
    );
  }
  return (body.payload ?? body.data) as T;
}

export interface ThirdPartyEndpoint {
  third_serial_number: string;
  name: string;
  display_category: string;
  capabilities: CubeCapability[];
  state: Record<string, unknown>;
  manufacturer: string;
  model: string;
  firmware_version: string;
  service_address: string;
  tags?: Record<string, unknown>;
}

/** Registers a device the backend will drive; resolves to the hub's serial number for it. */
export async function syncThirdPartyDevice(endpoint: ThirdPartyEndpoint): Promise<string> {
  const payload = await thirdPartyEvent<{ endpoints?: { serial_number?: string }[] }>({
    name: 'DiscoveryRequest',
    version: '2',
    payload: { endpoints: [endpoint] },
  });
  const serial = payload?.endpoints?.[0]?.serial_number;
  if (!serial) {
    throw new ApiError('cube_rejected', 'The CUBE hub accepted the device but returned no serial number.');
  }
  return serial;
}

export async function reportState(serial: string, thirdSerial: string, state: Record<string, unknown>): Promise<void> {
  await thirdPartyEvent({
    name: 'DeviceStatesChangeReport',
    version: '2',
    endpoint: { serial_number: serial, third_serial_number: thirdSerial },
    payload: { state },
  });
}

export async function reportOnline(serial: string, thirdSerial: string, online: boolean): Promise<void> {
  await thirdPartyEvent({
    name: 'DeviceOnlineChangeReport',
    version: '2',
    endpoint: { serial_number: serial, third_serial_number: thirdSerial },
    payload: { online },
  });
}
