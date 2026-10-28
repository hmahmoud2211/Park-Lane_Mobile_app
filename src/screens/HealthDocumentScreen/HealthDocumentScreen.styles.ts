import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels and rows; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    textBox: {
      padding: 12,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    muted: {
      color: theme.colors.textSecondary,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    grow: {
      flex: 1,
    },
  });
}
