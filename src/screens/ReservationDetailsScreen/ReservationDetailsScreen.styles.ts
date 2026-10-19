import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; no Figma frame exists for this screen yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    grow: {
      flex: 1,
    },
    divided: {
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    extend: {
      gap: 6,
    },
    endNote: {
      marginHorizontal: 2,
    },
  });
}
