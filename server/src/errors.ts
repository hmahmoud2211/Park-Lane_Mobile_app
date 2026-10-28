/**
 * Errors the API reports as `{ ok: false, error: { code, message } }`. The
 * codes match BackendErrorCode in the app (src/services/cube/cubeBackendService.ts).
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'not_controllable'
  | 'device_unreachable'
  | 'device_not_found'
  | 'key_rejected'
  | 'unsupported_device'
  | 'public_url_missing'
  | 'mdns_unavailable'
  | 'cube_unreachable'
  | 'cube_auth'
  | 'cube_rejected'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'device_offline'
  | 'command_timeout'
  | 'not_configured'
  | 'amazon_error'
  | 'link_expired'
  // Health Passport and the clinic (server/src/health, server/src/clinic).
  | 'invalid'
  | 'too_large'
  | 'consent_required'
  | 'slot_taken'
  | 'invalid_transition'
  | 'version_conflict'
  | 'ai_failed'
  | 'speech_failed'
  | 'internal';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  not_found: 404,
  not_controllable: 409,
  device_unreachable: 502,
  device_not_found: 404,
  key_rejected: 422,
  unsupported_device: 422,
  public_url_missing: 503,
  mdns_unavailable: 503,
  cube_unreachable: 502,
  cube_auth: 502,
  cube_rejected: 502,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  device_offline: 503,
  command_timeout: 504,
  not_configured: 503,
  amazon_error: 502,
  link_expired: 401,
  invalid: 422,
  too_large: 413,
  consent_required: 403,
  slot_taken: 409,
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
