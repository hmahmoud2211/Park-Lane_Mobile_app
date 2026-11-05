import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/**
 * No Figma frame exists for the booking flow; it is built from the Visitor
 * Access form's parts (neon panels, dark fields, gradient CTA) at the
 * parking flows' readable type sizes.
 */
export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    summaryText: {
      flex: 1,
      gap: 2,
    },
    summaryBadge: {
      width: 38,
      height: 38,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selected: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    // The chosen bay as a lit tile, like the bay on the map.
    selectedBadge: {
      width: 64,
      height: 56,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1.5,
      borderColor: theme.colors.electricCyan,
      backgroundColor: theme.colors.infoFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      shadowColor: theme.colors.electricCyan,
      shadowOpacity: 0.6,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    selectedBadgeEmpty: {
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      shadowOpacity: 0,
      elevation: 0,
    },
    note: {
      marginHorizontal: 2,
    },
  });
}
