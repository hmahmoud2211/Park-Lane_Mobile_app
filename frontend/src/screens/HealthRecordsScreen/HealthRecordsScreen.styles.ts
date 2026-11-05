import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels and rows; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    trend: {
      marginTop: 2,
    },
    empty: {
      color: theme.colors.textSecondary,
    },
  });
}
