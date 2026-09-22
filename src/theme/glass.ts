import type { BlurTint } from 'expo-blur';

import { colors } from './colors';

/**
 * The signature "Glass" frame of the Parklane design system, transcribed from
 * the Figma inspector capture (assets/Color Design/color sign in frame.png):
 *
 *   Effects        Glass, Drop shadow
 *   Fill           Linear gradient #4F7BFF -> #FF5CCB
 *   Fill opacity   20%
 *   Stroke         #FFFFFF
 *
 * Used by the screen 1 CTA, and reused by the cards and inputs on later screens.
 */
export const glass = {
  gradientColors: [colors.frameGradientStart, colors.frameGradientEnd] as const,
  gradientStart: { x: 0, y: 0 },
  gradientEnd: { x: 1, y: 0 },
  fillOpacity: 0.2,
  strokeWidth: 1,
  strokeColor: colors.frameStroke,
  blurIntensity: 24,
  blurTint: 'dark' as BlurTint,
} as const;
