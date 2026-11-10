import type { ApiErrorCode } from '../../shared/contracts/errors.ts';

/**
 * Errors the API reports as `{ ok: false, error: { code, message } }`. The
 * codes are part of the contract the app shares (shared/contracts/errors.ts).
 */
export type { ApiErrorCode };

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  not_available: 409,
  no_home: 404,
  provisioning: 503,
  hub_offline: 503,
  hub_auth: 502,
  ha_rejected: 502,
  not_configured: 503,
  flow_expired: 410,
  no_gateway: 404,
  password_change_required: 403,
  invalid: 422,
  too_large: 413,
  consent_required: 403,
  slot_taken: 409,
  parking_refused: 409,
  invalid_transition: 409,
  version_conflict: 409,
  ai_failed: 502,
  speech_failed: 502,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** For `invalid`: the field that was refused, which Health Passport shows beside its message. */
  readonly field?: string;

  constructor(code: ApiErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.field = field;
  }
}
