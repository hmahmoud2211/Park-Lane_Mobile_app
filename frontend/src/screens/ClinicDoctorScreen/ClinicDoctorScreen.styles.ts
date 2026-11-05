import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

export const PHOTO_SIZE = 76;

/** Built from Health Passport's panels; no Figma frame exists for the clinic yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    photo: {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      borderRadius: PHOTO_SIZE / 2,
      borderWidth: 1,
      borderColor: theme.colors.avatarStroke,
    },
    names: {
      flex: 1,
      gap: 2,
    },
    muted: {
      color: theme.colors.textSecondary,
    },
    hours: {
      gap: 2,
    },
  });
}
