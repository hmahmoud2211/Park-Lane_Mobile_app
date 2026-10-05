/**
 * The Parklane Assistant backend (FRONTEND_INTEGRATION.md). REST answers text
 * questions; the WebSocket carries the realtime voice and camera session.
 *
 * Override the host per build with EXPO_PUBLIC_ASSISTANT_URL, e.g.
 * `http://192.168.1.20:8001` for a backend on the LAN. The WebSocket base is
 * derived from it (https -> wss), as the mic and camera need a secure origin.
 */
const DEFAULT_ASSISTANT_URL = 'https://attal_voice_demo.ems-iot.com';

const httpBase = (process.env.EXPO_PUBLIC_ASSISTANT_URL ?? DEFAULT_ASSISTANT_URL).replace(/\/+$/, '');

export const assistantConfig = {
  httpBase,
  wsBase: httpBase.replace(/^http/, 'ws'),
  apiPrefix: '/api/v1',

  /**
   * Who the assistant answers for until the app has real sign-in. The
   * backend's demo residents are 1001 (Youssef, H-601) and 1002 (Ali, B-305);
   * the assistant's menu switches between them. `null` asks as a guest.
   * TODO(auth): take this from the signed-in user once login is wired up.
   */
  defaultResidentId: 1001 as number | null,

  /** A typical answer takes 2-5s; beyond this the request is abandoned. */
  chatTimeoutMs: 45_000,
  lookupTimeoutMs: 12_000,

  /** The realtime session's audio: PCM16, little-endian, mono, 24 kHz. */
  sampleRate: 24_000,
  /** The server waits 8s for a camera frame; reply well inside that. */
  cameraReplyBudgetMs: 6_500,
} as const;
