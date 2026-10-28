import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' booking details; no Figma frame exists for the clinic yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    actions: {
      gap: theme.spacing.sm,
    },
    muted: {
      color: theme.colors.textSecondary,
    },
  });
}
