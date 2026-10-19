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
