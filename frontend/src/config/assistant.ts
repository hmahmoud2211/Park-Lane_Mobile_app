import { DEMO_ASSISTANT_RESIDENT_ID } from './demo';
import { env } from './env';

/**
 * The Parklane Assistant backend (FRONTEND_INTEGRATION.md). REST answers text
 * questions; the WebSocket carries the realtime voice and camera session.
 *
 * Override the host per build with EXPO_PUBLIC_ASSISTANT_URL, e.g.
 * `http://192.168.1.20:8001` for a backend on the LAN. The WebSocket base is
 * derived from it (https -> wss), as the mic and camera need a secure origin.
 */
const DEFAULT_ASSISTANT_URL = 'https://attal_voice_2.ems-iot.com';

const httpBase = (env.assistantUrl ?? DEFAULT_ASSISTANT_URL).replace(/\/+$/, '');

export const assistantConfig = {
  httpBase,
  wsBase: httpBase.replace(/^http/, 'ws'),
  apiPrefix: '/api/v1',

  /** Who the assistant answers for until the app has real sign-in (config/demo.ts). */
  defaultResidentId: DEMO_ASSISTANT_RESIDENT_ID,

  /** A typical answer takes 2-5s; beyond this the request is abandoned. */
  chatTimeoutMs: 45_000,
  lookupTimeoutMs: 12_000,

  /** The realtime session's audio: PCM16, little-endian, mono, 24 kHz. */
  sampleRate: 24_000,
  /** The server waits 8s for a camera frame; reply well inside that. */
  cameraReplyBudgetMs: 6_500,
} as const;
