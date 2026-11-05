import { borderRadius } from './borderRadius';
import { breakpoints } from './breakpoints';
import { colors } from './colors';
import { glass } from './glass';
import { layout } from './layout';
import { motion } from './motion';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { fontFamily, typography } from './typography';

export { borderRadius, breakpoints, colors, glass, layout, motion, shadows, spacing, fontFamily, typography };
export { breakpointFor, type Breakpoint } from './breakpoints';
export type { TypographyVariant } from './typography';

/**
 * The single theme shipped today. ThemeContext resolves a theme by name, so a
 * second palette can be added here without touching any component.
 */
export const parklaneTheme = {
  colors,
  typography,
  fontFamily,
  spacing,
  borderRadius,
  shadows,
  glass,
  breakpoints,
  layout,
  motion,
} as const;
