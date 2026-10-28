import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Page thumbnails at roughly A4 proportions. */
export const THUMB_WIDTH = 72;
export const THUMB_HEIGHT = 100;

/** Built from the parking flows' panels and rows; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    sources: {
      gap: 8,
    },
    tips: {
      gap: 12,
    },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    tipText: {
      flex: 1,
    },
    pageLabel: {
      maxWidth: THUMB_WIDTH,
    },
    pages: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    page: {
      width: THUMB_WIDTH,
      gap: 4,
      alignItems: 'center',
    },
    thumb: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: {
      width: '100%',
      height: '100%',
    },
    remove: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.scrimBottom,
    },
    footer: {
      gap: 8,
    },
    muted: {
      color: theme.colors.textSecondary,
    },
  });
}
