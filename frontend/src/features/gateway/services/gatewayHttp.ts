import { gatewayConfig } from '../../../config/gateway';

/**
 * Requests to a CUBE Gateway. Every answer is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, recovery } }`; failures throw
 * GatewayError with the gateway's code and its suggested next step, so a
 * screen can say "accept on the TV" rather than just "failed".
 *
 * Unlike the EMS backend there is no single address: each call names the
 * gateway's base URL (LAN, Tailscale or relay) and, except for the public
 * routes, the phone's token for that gateway.
 */

export type GatewayErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'already_claimed'
  | 'conflict'
  | 'device_busy'
  | 'bad_request'
  | 'bad_params'
  | 'rate_limited'
  | 'not_supported'
  | 'adapter_unavailable'
  | 'device_unreachable'
  | 'adapter_timeout'
  | 'auth_required'
  | 'local_key_required'
  | 'pairing_rejected'
  | 'device_auth_failed'
  | 'device_rejected'
  | 'unverified_gateway'
  | 'internal'
  | (string & {});

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly recovery: string | null;
  readonly status?: number;

  constructor(code: GatewayErrorCode, message: string, recovery: string | null = null, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.recovery = recovery;
    this.status = status;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; recovery?: string | null } };

export interface GatewayTarget {
  baseUrl: string;
  /** Omitted for the public routes (health, identity challenge, claim, join). */
  token?: string | null;
}

export interface CallInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Listeners told when a gateway refuses a token, so the app can drop it. */
const refusedListeners = new Set<(baseUrl: string) => void>();

export function onTokenRefused(listener: (baseUrl: string) => void): () => void {
  refusedListeners.add(listener);
  return () => refusedListeners.delete(listener);
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  return error instanceof GatewayError ? error.message : fallback;
}

export async function gatewayCall<T>(target: GatewayTarget, path: string, init: CallInit = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? gatewayConfig.requestTimeoutMs);
  const forwardAbort = () => controller.abort();
  init.signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(`${target.baseUrl}${gatewayConfig.apiPrefix}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      if (init.signal?.aborted) {
        throw new GatewayError('cancelled', 'Stopped.');
      }
      throw timedOut
        ? new GatewayError('timeout', 'The gateway took too long to answer.', 'Check that it is running and that your phone is on the same network.')
        : new GatewayError('network', 'Could not reach the gateway.', 'Check that it is running and that your phone is on the same network, or use its remote address.');
    }

    const body = (await response.json().catch(() => undefined)) as Envelope<T> | undefined;
    if (!body || typeof body.ok !== 'boolean') {
      throw new GatewayError('internal', `The gateway answered ${response.status}.`, null, response.status);
    }
    if (!body.ok) {
      if (body.error.code === 'unauthorized' && target.token) {
        refusedListeners.forEach((listener) => listener(target.baseUrl));
      }
      throw new GatewayError(body.error.code, body.error.message, body.error.recovery ?? null, response.status);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', forwardAbort);
  }
}
