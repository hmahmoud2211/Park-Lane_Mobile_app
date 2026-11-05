import { jsonRequest, timedFetch } from '../../../lib/http/request';

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
  return timedFetch(url, {
    init: jsonRequest(init.method ?? 'GET', init.body),
    timeoutMs: init.timeoutMs,
    signal: init.signal,
    noAnswer: ({ timedOut, aborted }) => {
      if (aborted) {
        return new DeviceHttpError('aborted', 'Stopped.');
      }
      return timedOut
        ? new DeviceHttpError('timeout', 'The device did not answer in time.')
        : new DeviceHttpError('unreachable', 'Could not reach the device on its setup network.');
    },
    read: async (response) => {
      if (!response.ok) {
        throw new DeviceHttpError('httpError', `The device answered ${response.status}.`, response.status);
      }
      return await response.json().catch(() => {
        throw new DeviceHttpError('invalidResponse', 'The device’s answer was not valid JSON.');
      });
    },
  });
}
