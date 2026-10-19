import { sonoffConfig } from '../../constants/sonoffConfig';
import type { DeviceKey, SonoffDetection, SonoffDeviceInfo } from '../../types/sonoff.types';

/**
 * Talks to a SONOFF plug on its setup hotspot. Only `GET /device` is used
 * here: it is the one endpoint confirmed to answer on the S26R2TPF, and it
 * returns `{ deviceid, apikey, accept, chipid }`.
 *
 * Nothing in this file logs. The `apikey` comes back sealed (see DeviceKey).
 */

export type SonoffDeviceErrorKind = 'timeout' | 'unreachable' | 'httpError' | 'invalidResponse' | 'aborted';

export class SonoffDeviceError extends Error {
  readonly kind: SonoffDeviceErrorKind;
  readonly status?: number;

  constructor(kind: SonoffDeviceErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'SonoffDeviceError';
    this.kind = kind;
    this.status = status;
  }
}

const REDACTED = '[redacted]';

export function sealDeviceKey(value: string): DeviceKey {
  return Object.freeze({
    reveal: () => value,
    toString: () => REDACTED,
    toJSON: () => REDACTED,
  });
}

/** Device ids are 10 hex digits on every eWeLink Wi-Fi device seen so far. */
const DEVICE_ID = /^[0-9a-f]{10}$/i;

function stringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Checks the shape before anything is shown, so a stray web server on 10.10.7.1 is not taken for the plug. */
function parseDevice(body: unknown): SonoffDetection {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SonoffDeviceError('invalidResponse', 'The device answered, but not with SONOFF device details.');
  }
  const record = body as Record<string, unknown>;
  const deviceId = stringField(record, 'deviceid');
  const apikey = stringField(record, 'apikey');
  if (!deviceId || !DEVICE_ID.test(deviceId) || !apikey) {
    throw new SonoffDeviceError(
      'invalidResponse',
      'The device answered, but its details are missing a device ID or key.',
    );
  }
  const info: SonoffDeviceInfo = {
    deviceId: deviceId.toLowerCase(),
    chipId: stringField(record, 'chipid') ?? '',
    accept: stringField(record, 'accept') ?? '',
  };
  return { info, key: sealDeviceKey(apikey) };
}

async function requestDevice(timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(`${sonoffConfig.apBaseUrl}/device`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) {
        throw new SonoffDeviceError('aborted', 'Stopped.');
      }
      throw timedOut
        ? new SonoffDeviceError('timeout', 'The device did not answer in time.')
        : new SonoffDeviceError('unreachable', 'Could not reach a device at 10.10.7.1.');
    }
    if (!response.ok) {
      throw new SonoffDeviceError('httpError', `The device answered ${response.status}.`, response.status);
    }
    return await response.json().catch(() => {
      throw new SonoffDeviceError('invalidResponse', 'The device’s answer was not valid JSON.');
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** One `GET /device`: the plug's id, chip id and sealed key. */
export async function getDeviceInformation(
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SonoffDetection> {
  const body = await requestDevice(options.timeoutMs ?? sonoffConfig.detectTimeoutMs, options.signal);
  return parseDevice(body);
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * `getDeviceInformation` with retries, for the moment just after the phone
 * joins the hotspot, when the first request often goes out before the route
 * is up. Only network failures are retried: a wrong answer will not improve.
 */
export async function detectSonoffDevice(
  options: { attempts?: number; signal?: AbortSignal } = {},
): Promise<SonoffDetection> {
  const attempts = options.attempts ?? sonoffConfig.detectAttempts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getDeviceInformation({ signal: options.signal });
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof SonoffDeviceError && (error.kind === 'timeout' || error.kind === 'unreachable');
      if (!retryable || attempt === attempts || options.signal?.aborted) {
        break;
      }
      await wait(sonoffConfig.detectRetryDelayMs, options.signal);
    }
  }
  throw lastError;
}

/**
 * Whether anything answers `/device` right now. Used to tell when the plug
 * has left pairing mode: any HTTP answer counts as there, only silence as gone.
 */
export async function checkDeviceConnectivity(
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  try {
    await requestDevice(options.timeoutMs ?? sonoffConfig.detectTimeoutMs, options.signal);
    return true;
  } catch (error) {
    return error instanceof SonoffDeviceError && (error.kind === 'httpError' || error.kind === 'invalidResponse');
  }
}
