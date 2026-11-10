/**
 * The error codes the device backend answers with, in `{ ok: false, error: { code, message } }`.
 * The backend maps each to an HTTP status (backend/src/errors.ts); the app adds its own
 * client-side codes on top (network, timeout) in frontend/src/services/ems/emsHttp.ts.
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
  // CUBE gateway access through the account: the resident's unit has no gateway yet.
  | 'no_gateway'
  // An account with a temporary password must choose its own before anything else.
  | 'password_change_required'
  // Health Passport and the clinic.
  | 'invalid'
  | 'too_large'
  | 'consent_required'
  | 'slot_taken'
  /** A parking rule refused the step; `field` names the rule (e.g. space-unavailable, guest-limit, stale). */
  | 'parking_refused'
  | 'invalid_transition'
  | 'version_conflict'
  | 'ai_failed'
  | 'speech_failed'
  | 'internal';
