import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels; demo tooling has no Figma frame. */
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
    quarter: {
      flexGrow: 1,
      flexBasis: '22%',
    },
    policyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    policyLabel: {
      flex: 1,
    },
  });
}
