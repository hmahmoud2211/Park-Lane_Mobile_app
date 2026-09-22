import type { ViewStyle } from 'react-native';

import { colors } from './colors';

/**
 * The "Drop shadow" half of the Glass frame effect. Rendered as a coloured
 * glow rather than a neutral shade, matching the neon treatment in the design.
 */
export const shadows = {
  none: {
    shadowColor: colors.transparent,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  glow: {
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  card: {
    shadowColor: colors.black,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} satisfies Record<string, ViewStyle>;
