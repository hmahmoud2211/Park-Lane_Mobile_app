import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' form panels; no Figma frame exists for the clinic yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    checks: {
      gap: theme.spacing.sm,
    },
  });
}
