/**
 * The one place the app calls fetch for its JSON APIs (EMS backend, CUBE gateway,
 * Parklane Assistant, devices on their setup hotspots). Each client words its own
 * errors; this handles the timeout, the caller's cancel and the headers.
 */

/** How a request that got no answer at all failed. */
export interface NoAnswer {
  /** The timeout fired. */
  timedOut: boolean;
  /** The caller's signal was aborted. */
  aborted: boolean;
}

export interface TimedFetchOptions<T> {
  /** Everything but the signal, which timedFetch owns. */
  init?: Omit<RequestInit, 'signal'>;
  timeoutMs: number;
  /** The caller's cancel; aborting it aborts the request. */
  signal?: AbortSignal;
  /**
   * The error to throw when no answer came back. Both flags can be set at once, and each
   * client decides which wins (the assistant reports the timeout, the others the cancel).
   */
  noAnswer: (why: NoAnswer) => Error;
  /** Reads the answer. It runs while the timeout still applies, so a body that never arrives times out too. */
  read: (response: Response) => Promise<T>;
}

export async function timedFetch<T>(url: string, options: TimedFetchOptions<T>): Promise<T> {
  const { init, timeoutMs, signal, noAnswer, read } = options;
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
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw noAnswer({ timedOut, aborted: signal?.aborted ?? false });
    }
    return await read(response);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** A JSON request: Accept JSON, the body serialized with its Content-Type, and a bearer token when given. */
export function jsonRequest(method: string, body: unknown, token?: string | null): Omit<RequestInit, 'signal'> {
  return {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}
