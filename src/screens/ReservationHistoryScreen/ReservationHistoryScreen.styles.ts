import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; no Figma frame exists for history yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    summary: {
      marginHorizontal: theme.spacing.xs / 2,
    },
  });
}
