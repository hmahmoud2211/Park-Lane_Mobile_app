import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** Built from the parking flows' panels and rows; no Figma frame exists for Health Passport yet. */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    actions: {
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    grow: {
      flex: 1,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    profileText: {
      flex: 1,
      gap: 2,
    },
    gap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    gapDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    gapText: {
      flex: 1,
    },
    // AppButton sizes from its container, so beside text it needs a width of its own.
    fixButton: {
      minWidth: 124,
    },
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    lineText: {
      flex: 1,
    },
    hint: {
      marginTop: -2,
      marginHorizontal: 2,
    },
  });
}
