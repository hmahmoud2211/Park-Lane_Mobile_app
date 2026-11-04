import { env } from './env';

/** Features that can be switched per build (EXPO_PUBLIC_* variables, see env.ts). */
export const flags = {
  /**
   * The parking demo's tools: the Demo controls and Security console screens, reached from
   * the Parking menu and the demo strip. On unless EXPO_PUBLIC_DEMO_TOOLS is 0, false or off.
   */
  demoTools: !['0', 'false', 'off'].includes((env.demoTools ?? '').trim().toLowerCase()),
  /** Testing aid: every screen gets a visual/<Route> web address (AppNavigator). */
  visualRoutes: env.visualRoutes === '1',
} as const;
