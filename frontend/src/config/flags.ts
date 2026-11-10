import { env } from './env';

const off = (value: string | undefined) => ['0', 'false', 'off'].includes((value ?? '').trim().toLowerCase());

/**
 * The App Store / Google Play build (EXPO_PUBLIC_STORE_MODE=1, set in eas.json `production`).
 * Store reviewers reject sample data and placeholders, and a resident must never believe a
 * request reached management when it only stayed on the phone. So this build leaves out
 * every part that is not backed by a real service yet (parking, visitor passes, maintenance,
 * community, amenities, BMS, My Unit's figures and documents, the "coming soon" pages) and
 * shows the signed-in person instead of the demo resident. Development and preview builds
 * keep everything. Turn a part back on here once its backend exists.
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
  /** Sample data and placeholder pages (see storeMode): shown everywhere but the store build. */
  sampleContent: !storeMode,
  /** Testing aid: every screen gets a visual/<Route> web address (AppNavigator). */
  visualRoutes: env.visualRoutes === '1',
} as const;
