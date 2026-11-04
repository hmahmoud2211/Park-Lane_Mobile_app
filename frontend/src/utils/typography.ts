import type { TextStyle } from 'react-native';

import type { TypographyVariant } from '../theme';
import type { AppTheme } from '../types/theme.types';

/**
 * A typography token scaled for a narrower card (see statScaleFor): its font size and
 * line height times `scale`. Nothing at scale 1, so the token itself applies unchanged.
 */
export function scaledType(theme: AppTheme, variant: TypographyVariant, scale: number): TextStyle {
  const { fontSize, lineHeight } = theme.typography[variant] as TextStyle;
  return scale === 1 || fontSize === undefined || lineHeight === undefined
    ? {}
    : { fontSize: fontSize * scale, lineHeight: lineHeight * scale };
}
