import type { ViewStyle } from 'react-native';

/**
 * Animation timings shared by every transition, so the app moves at one
 * pace. Components that animate read these rather than their own numbers,
 * and skip the motion when the user asks for reduced motion
 * (hooks/useReduceMotion).
 */
export const motion = {
  duration: {
    /** Press feedback and toggles. */
    fast: 120,
    /** Most entrances, fades and layout changes. */
    base: 220,
    /** Larger surfaces: sheets, rails, page sections. */
    slow: 360,
  },
  /** How far an entering section rises into place. */
  enterOffset: 12,
  /** Stagger between items of an entering list. */
  stagger: 40,

  /** The pressed state shared by tappable cards, tiles and tabs. */
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  } satisfies ViewStyle,
} as const;
