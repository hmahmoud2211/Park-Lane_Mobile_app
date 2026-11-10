import type { ApiErrorCode } from './errors.ts';

/** Every answer from the device backend: `{ ok: true, data }` or `{ ok: false, error }`. */
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** For `invalid`: the field that was refused, so the app can show the message beside it. */
  field?: string;
}
