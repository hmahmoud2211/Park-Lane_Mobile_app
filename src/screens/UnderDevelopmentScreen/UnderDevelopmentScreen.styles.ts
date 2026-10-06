import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference exists for this placeholder; the header matches My Unit's
 * (assets/Screens/screen4.png) so the title holds its line between screens.
 */
const GUTTER = 16;
const HEADER_TOP = 28;
const HEADER_ROW_HEIGHT = 38;
const HEADER_INSET_LEFT = 8;

export const ICON_DISC_SIZE = 72;
export const ICON_SIZE = 32;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      flex: 1,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: HEADER_TOP,
      paddingHorizontal: GUTTER,
      paddingBottom: NAV_BAR_CLEARANCE + theme.spacing.md,
    },
    headerRow: {
      height: HEADER_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: HEADER_INSET_LEFT,
    },
    headerTitle: {
      flex: 1,
    },
    body: {
      flex: 1,
      justifyContent: 'center',
    },
    card: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
    },
    iconDisc: {
      width: ICON_DISC_SIZE,
      height: ICON_DISC_SIZE,
      borderRadius: ICON_DISC_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
    },
    iconGlow: {
      borderRadius: ICON_DISC_SIZE / 2,
      ...theme.shadows.glow,
      shadowColor: theme.colors.violet,
    },
    badge: {
      marginTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.sm + theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.borderRadius.pill,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.chipVioletStrokeTo,
      backgroundColor: theme.colors.chipVioletFill,
    },
    heading: {
      marginTop: theme.spacing.md,
    },
    message: {
      marginTop: theme.spacing.sm,
    },
    cta: {
      marginTop: theme.spacing.lg,
      alignSelf: 'stretch',
    },
  });
}
