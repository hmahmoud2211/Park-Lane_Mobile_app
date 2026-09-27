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
  /**
   * The same gradient at a lighter tint, for content-dense screens where every
   * panel is glass (measured on the My Unit screenshot, assets/Screens/screen4.png).
   */
  subtleFillOpacity: 0.05,
  strokeWidth: 1,
  strokeColor: colors.frameStroke,
  blurIntensity: 24,
  blurTint: 'dark' as BlurTint,

  /**
   * The neon card edge on the My Unit design (assets/Screens/screen4.png),
   * measured from its pixel profiles. The stroke is a dim blue-to-violet
   * that lights up only around the corners (cyan on the left, violet on the
   * right), where a faint halo also spills outside. A dark ring separates the
   * card from the page, a pale highlight sits on the top and bottom edges,
   * and a blue wash fades in from the edge.
   */
  neon: {
    strokeWidth: 1.25,
    /** The stroke between the corners: this colour into the right-hand one. */
    baseFrom: colors.neonBlue,
    baseOpacity: 0.72,
    /** Reach of each corner's glow, capped at this fraction of the width. */
    cornerGlowRadius: 72,
    cornerGlowMaxSpan: 0.35,
    /** Glow strength halfway out from the corner. */
    cornerGlowMidOpacity: 0.7,
    bottomCornerOpacity: 0.8,
    /** The wash brightens near the corners too: opacity per 1.5dp ring inward. */
    cornerWashRings: [0.16, 0.1, 0.06, 0.03],
    /** Opacity of each 1.5dp halo ring, working outward; corners only. */
    haloRings: [0.12, 0.05],
    shadowColor: colors.black,
    shadowOpacity: 0.5,
    /** Inner wash: blue until near the right edge, then the right-hand colour. */
    innerGlowFrom: colors.neonBlue,
    innerGlowFromOpacity: 0.7,
    innerGlowOpacity: 0.2,
    /** Distance over which the wash falls to about a third. */
    innerGlowFalloff: 7,
    innerGlowWidth: 12,
    highlightColor: colors.white,
    highlightOpacity: 0.35,
    /** Highlight position and half-width, as fractions of the card's width. */
    highlightCenter: 0.4,
    highlightSpread: 0.1,
  },
} as const;
