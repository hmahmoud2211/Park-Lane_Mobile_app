import { emsConfig } from './emsConfig';

/**
 * Health Passport's backend. `mock` runs the whole feature on sample data
 * inside the app; `http` uses the real endpoints at
 * EXPO_PUBLIC_HEALTH_API_URL, which defaults to the EMS backend the app
 * already signs in to. The app only ever talks to its own backend: no AI
 * server address or key belongs here.
 *
 * EXPO_PUBLIC_HEALTH_API=mock or =http chooses. Left unset, development runs
 * the mock and release builds use the real backend, so sample records and
 * their media never ship to residents unless a build asks for them.
 */
// `typeof` first: the Node checks load this file, and Node has no __DEV__.
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
const mode: 'mock' | 'http' =
  process.env.EXPO_PUBLIC_HEALTH_API === 'mock' || (isDev && process.env.EXPO_PUBLIC_HEALTH_API !== 'http')
    ? 'mock'
    : 'http';

export const healthConfig = {
  mode,
  baseUrl: (process.env.EXPO_PUBLIC_HEALTH_API_URL ?? emsConfig.url).replace(/\/+$/, ''),
  /** The app's usual request budget. */
  requestTimeoutMs: emsConfig.requestTimeoutMs,
  uploadTimeoutMs: 2 * 60_000,

  /** Status checks on a document being read: often at first, then less, then give up. */
  poll: {
    fastIntervalMs: 5_000,
    fastForMs: 60_000,
    slowIntervalMs: 20_000,
    giveUpAfterMs: 15 * 60_000,
  },

  /**
   * Status checks on a summary being made in the background, which can take
   * several minutes on the server: every 5 s for a minute, then every 10 s.
   */
  summaryPoll: {
    fastIntervalMs: 5_000,
    fastForMs: 60_000,
    slowIntervalMs: 10_000,
    giveUpAfterMs: 20 * 60_000,
  },
} as const;
