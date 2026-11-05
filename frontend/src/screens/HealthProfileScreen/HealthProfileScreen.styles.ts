import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' form panels; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    hint: {
      marginTop: 6,
      color: theme.colors.textMuted,
    },
  });
}
