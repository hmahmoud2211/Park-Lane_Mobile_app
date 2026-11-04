import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; the console has no Figma frame. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    grow: {
      flexGrow: 1,
      flexBasis: '45%',
    },
    result: {
      alignItems: 'center',
      gap: 6,
      paddingVertical: theme.spacing.sm,
    },
  });
}
