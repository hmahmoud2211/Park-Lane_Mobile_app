import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels and notices; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    footer: {
      gap: 8,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    action: {
      flexGrow: 1,
      flexBasis: '30%',
    },
    figure: {
      padding: 10,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.fieldFill,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      gap: 2,
    },
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
    dimmed: {
      opacity: 0.55,
    },
  });
}
