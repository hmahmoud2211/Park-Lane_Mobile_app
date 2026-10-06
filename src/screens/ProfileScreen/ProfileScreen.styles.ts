import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';

const HEADER_TOP = 28;
const HEADER_TO_IDENTITY = 24;
const IDENTITY_TO_PASS = 18;
const PASS_TO_MENU = 22;
const MENU_ROW_GAP = 10;

/** The QR needs a light card to stay scannable, whatever the surrounding theme. */
export const PASS_SIZE = 168;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      paddingTop: HEADER_TOP,
      // Clears the pinned bottom bar.
      paddingBottom: NAV_BAR_CLEARANCE + theme.spacing.md,
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: HEADER_TO_IDENTITY,
    },

    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm + 2,
      marginBottom: IDENTITY_TO_PASS,
    },
    identityText: {
      flex: 1,
      marginLeft: theme.spacing.sm + 2,
    },

    passCard: {
      alignItems: 'center',
      paddingVertical: theme.spacing.lg,
      marginBottom: PASS_TO_MENU,
    },
    passSurface: {
      // Deliberately opaque white: QR readers need the contrast.
      backgroundColor: theme.colors.white,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
    },
    passCaption: {
      marginTop: theme.spacing.md,
    },

    menuRow: {
      marginBottom: MENU_ROW_GAP,
    },
  });
}
