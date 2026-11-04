/**
 * Errors the API reports as `{ ok: false, error: { code, message } }`. The
 * codes match EmsErrorCode in the app (src/services/ems/emsApi.ts).
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'not_available'
  | 'no_home'
  | 'provisioning'
  | 'hub_offline'
  | 'hub_auth'
  | 'ha_rejected'
  | 'not_configured'
  | 'flow_expired'
  | 'internal';

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
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
  }
}
