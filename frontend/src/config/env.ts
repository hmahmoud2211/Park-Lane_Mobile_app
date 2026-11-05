/**
 * Every build-time setting the app reads. Expo inlines EXPO_PUBLIC_* variables into the
 * bundle, so they are read here once, each written out in full (`process.env.EXPO_PUBLIC_X`):
 * Expo replaces only that exact form, not destructuring or a computed key.
 *
 * Set them in frontend/.env.local for development (see .env.example) and per build profile
 * in eas.json. They end up in the app, so never put a secret in one.
 */
export const env = {
  /** The EMS device backend (backend/), e.g. http://192.168.1.50:8787. Empty: smart-home sign-in says it is not configured. */
  deviceBackendUrl: process.env.EXPO_PUBLIC_DEVICE_BACKEND_URL,
  /** The Parklane Assistant backend. Unset: the hosted demo (config/assistant.ts). */
  assistantUrl: process.env.EXPO_PUBLIC_ASSISTANT_URL,
  /** `0`, `false` or `off` hides the parking demo's tools (config/flags.ts). */
  demoTools: process.env.EXPO_PUBLIC_DEMO_TOOLS,
  /** `1` gives every screen a web address for the visual-regression script. */
  visualRoutes: process.env.EXPO_PUBLIC_VISUAL_ROUTES,
  /**
   * Health Passport's service, `mock` or `http` (config/health.ts). The one variable also
   * read elsewhere, in features/health/services/createHealthService.ts and media.ts: the
   * bundler can leave the mock and its sample records out of a build only when it sees the
   * value right at the require().
   */
  healthApi: process.env.EXPO_PUBLIC_HEALTH_API,
  /** Health Passport's backend. Unset: the EMS backend. */
  healthApiUrl: process.env.EXPO_PUBLIC_HEALTH_API_URL,
} as const;
