import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** The language choice is large: the phone may be handed to the doctor for it. */
export const LANGUAGE_TILE_HEIGHT = 84;

/** Built from the parking flows' panels; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    languages: {
      flexDirection: 'row',
      gap: 10,
    },
    languageTile: {
      flex: 1,
    },
    languageSurface: {
      height: LANGUAGE_TILE_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    languageIdle: {
      backgroundColor: theme.colors.fieldFill,
    },
    pressed: {
      opacity: 0.75,
    },
    footer: {
      gap: 8,
    },
    generating: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    grow: {
      flex: 1,
    },
    sizeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    sizeButton: {
      width: 44,
      height: 44,
      borderRadius: theme.borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
    },
    disabled: {
      opacity: 0.4,
    },
    paragraphs: {
      gap: 12,
    },
  });
}
