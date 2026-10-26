import { sonoffConfig } from './sonoffConfig';

/**
 * The EMS backend: accounts, the device registry and the Alexa integration.
 * It is the same service as the SONOFF bridge (server/ in this repo), at
 * EXPO_PUBLIC_DEVICE_BACKEND_URL. Nothing secret is configured here: the app
 * authenticates with the signed-in user's own session token.
 */
const backendUrl = sonoffConfig.backend.url;

export const emsConfig = {
  url: backendUrl,
  /** The realtime channel: the same host over ws(s). */
  eventsUrl: backendUrl ? `${backendUrl.replace(/^http/, 'ws')}/api/events` : '',
  requestTimeoutMs: 12_000,
  /** Registering a SONOFF plug waits for its LAN announcement. */
  registerTimeoutMs: 25_000,
  /** Where the backend sends the browser after Amazon linking (APP_RETURN_URL on the backend). */
  alexaReturnUrl: 'parklane://alexa-link',
  /** Realtime reconnects back off from 1 s to 30 s. */
  reconnectMinMs: 1_000,
  reconnectMaxMs: 30_000,
} as const;
