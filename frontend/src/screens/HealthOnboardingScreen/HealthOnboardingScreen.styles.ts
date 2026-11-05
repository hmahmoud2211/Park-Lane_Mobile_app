import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels and rows; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    footer: {
      gap: 8,
    },
    points: {
      gap: 14,
    },
    consent: {
      paddingVertical: 4,
    },
    muted: {
      color: theme.colors.textSecondary,
    },
  });
}
