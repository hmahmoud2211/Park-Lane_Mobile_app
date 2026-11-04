import type { ApiErrorCode } from './errors.ts';

/** Every answer from the device backend: `{ ok: true, data }` or `{ ok: false, error }`. */
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}
