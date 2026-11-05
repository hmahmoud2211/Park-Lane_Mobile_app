import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; no Figma frame exists for the visitor pass yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    facts: {
      gap: 12,
      marginTop: theme.spacing.xs,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    security: {
      gap: 10,
    },
    footer: {
      marginHorizontal: 2,
      textAlign: 'center',
    },
  });
}
