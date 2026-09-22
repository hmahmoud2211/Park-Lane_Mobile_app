import { borderRadius } from './borderRadius';
import { colors } from './colors';
import { glass } from './glass';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { fontFamily, typography } from './typography';

export { borderRadius, colors, glass, shadows, spacing, fontFamily, typography };
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
} as const;
