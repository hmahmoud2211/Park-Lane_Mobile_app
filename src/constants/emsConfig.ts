/**
 * The EMS backend (server/ in this repo), at EXPO_PUBLIC_DEVICE_BACKEND_URL,
 * e.g. `http://192.168.1.50:8787` in .env.local. Nothing secret is configured
 * here: the app authenticates with the signed-in user's own session token.
 */
const backendUrl = (process.env.EXPO_PUBLIC_DEVICE_BACKEND_URL ?? '').replace(/\/+$/, '');

export const emsConfig = {
  url: backendUrl,
  /** The realtime channel: the same host over ws(s). */
  eventsUrl: backendUrl ? `${backendUrl.replace(/^http/, 'ws')}/api/events` : '',
  requestTimeoutMs: 12_000,
  /** Realtime reconnects back off from 1 s to 30 s. */
  reconnectMinMs: 1_000,
  reconnectMaxMs: 30_000,
} as const;
