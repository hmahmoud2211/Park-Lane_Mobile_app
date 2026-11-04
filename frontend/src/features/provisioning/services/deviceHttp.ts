/**
 * One HTTP request to a device on its own setup network, with a timeout.
 * Nothing here logs: request bodies can carry the home Wi-Fi password.
 */

export type DeviceHttpErrorKind = 'timeout' | 'unreachable' | 'httpError' | 'invalidResponse' | 'aborted';

export class DeviceHttpError extends Error {
  readonly kind: DeviceHttpErrorKind;
  readonly status?: number;

  constructor(kind: DeviceHttpErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'DeviceHttpError';
    this.kind = kind;
    this.status = status;
  }
}

export async function deviceRequest(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs);
  const forwardAbort = () => controller.abort();
  init.signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      if (init.signal?.aborted) {
        throw new DeviceHttpError('aborted', 'Stopped.');
      }
      throw timedOut
        ? new DeviceHttpError('timeout', 'The device did not answer in time.')
        : new DeviceHttpError('unreachable', 'Could not reach the device on its setup network.');
    }
    if (!response.ok) {
      throw new DeviceHttpError('httpError', `The device answered ${response.status}.`, response.status);
    }
    return await response.json().catch(() => {
      throw new DeviceHttpError('invalidResponse', 'The device’s answer was not valid JSON.');
    });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', forwardAbort);
  }
}
