import { env } from './env';

const off = (value: string | undefined) => ['0', 'false', 'off'].includes((value ?? '').trim().toLowerCase());

/**
 * The App Store / Google Play build (EXPO_PUBLIC_STORE_MODE=1, set in eas.json `production`).
 * Store reviewers reject sample data and placeholders, and a resident must never believe a
 * request reached management when it only stayed on the phone. So this build has only the
 * parts backed by the backend (My Unit and Bills, visitors and parcels, maintenance and other
 * requests, community, amenities, Smart Home, health, the clinic, the inbox) and leaves out the
 * rest: sample content, the "coming soon" pages, BMS (simulated readings only), and Parking
 * until its real layout is confirmed (see `parking`). Development and preview builds keep
 * everything.
 */
const storeMode = env.storeMode === '1';

/** Features that can be switched per build (EXPO_PUBLIC_* variables, see env.ts). */
export const flags = {
  storeMode,
  /**
   * The parking demo's tools: the Demo controls and Security console screens, reached from
   * the Parking menu and the demo strip. On unless EXPO_PUBLIC_DEMO_TOOLS is 0, false or off;
   * never in the store build.
   */
  demoTools: !storeMode && !off(env.demoTools),
  /**
   * Parking, from the backend. Its bays, gates and roads are still the design's sample layout, so the store build
   * leaves it out until building management confirms the real one and the build sets EXPO_PUBLIC_PARKING=1.
   */
  parking: !storeMode || env.parking === '1',
  /** Sample data and placeholder pages (see storeMode): shown everywhere but the store build. */
  sampleContent: !storeMode,
  /** Testing aid: every screen gets a visual/<Route> web address (AppNavigator). */
  visualRoutes: env.visualRoutes === '1',
} as const;
