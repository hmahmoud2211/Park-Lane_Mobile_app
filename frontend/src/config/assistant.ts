import { DEMO_ASSISTANT_RESIDENT_ID } from './demo';
import { env } from './env';
import { flags } from './flags';

/**
 * The Parklane Assistant backend (FRONTEND_INTEGRATION.md). REST answers text
 * questions; the WebSocket carries the realtime voice and camera session.
 *
 * Override the host per build with EXPO_PUBLIC_ASSISTANT_URL, e.g.
 * `http://192.168.1.20:8001` for a backend on the LAN. The WebSocket base is
 * derived from it (https -> wss), as the mic and camera need a secure origin.
 *
 * The host name must not contain an underscore. Android 10 and later refuse TLS
 * to such a name (OkHttp fails with "Android internal error"), so voice and chat
 * would work in the browser and on iPhone but not in the APK. Use hyphens.
 */
const DEFAULT_ASSISTANT_URL = 'https://attal-voice-2.ems-iot.com';

const httpBase = (env.assistantUrl ?? DEFAULT_ASSISTANT_URL).replace(/\/+$/, '');

if (__DEV__ && /^[a-z]+:\/\/[^/?#]*_/i.test(httpBase)) {
  console.warn(`[assistant] ${httpBase} has an underscore in its host name; Android cannot connect to it.`);
}

export const assistantConfig = {
  httpBase,
  wsBase: httpBase.replace(/^http/, 'ws'),
  apiPrefix: '/api/v1',

  /**
   * Who the assistant answers for until it knows the signed-in account (config/demo.ts). The
   * store build asks as no resident at all: it must never answer as someone else.
   */
  defaultResidentId: flags.sampleContent ? DEMO_ASSISTANT_RESIDENT_ID : null,

  /** The AI companies named in the consent screen (EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS). */
  aiProviders: (env.assistantAiProviders ?? '').trim() || null,

  /** A typical answer takes 2-5s; beyond this the request is abandoned. */
  chatTimeoutMs: 45_000,
  lookupTimeoutMs: 12_000,

  /** The realtime session's audio: PCM16, little-endian, mono, 24 kHz. */
  sampleRate: 24_000,
  /** The server waits 8s for a camera frame; reply well inside that. */
  cameraReplyBudgetMs: 6_500,
} as const;
