/**
 * The EMS backend and the CUBE gateway answer every request with an envelope:
 * `{ ok: true, data }` or `{ ok: false, error: { code, message, … } }`.
 */
export type Envelope<T, E = { code: string; message: string }> = { ok: true; data: T } | { ok: false; error: E };

/** The answer's body when it is an envelope; undefined when it is not JSON or has another shape (a proxy's error page). */
export async function readEnvelope<T, E = { code: string; message: string }>(response: Response): Promise<Envelope<T, E> | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  if (body === null || body === undefined || typeof (body as { ok?: unknown }).ok !== 'boolean') {
    return undefined;
  }
  return body as Envelope<T, E>;
}
