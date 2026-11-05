import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; no Figma frame exists for charging yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    figures: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    figure: {
      flex: 1,
    },
  });
}
