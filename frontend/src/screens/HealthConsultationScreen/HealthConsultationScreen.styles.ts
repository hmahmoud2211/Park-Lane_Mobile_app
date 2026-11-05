import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from Health Passport's record panels; no Figma frame exists for clinic visits yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    lines: {
      gap: 6,
    },
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    muted: {
      color: theme.colors.textSecondary,
    },
  });
}
