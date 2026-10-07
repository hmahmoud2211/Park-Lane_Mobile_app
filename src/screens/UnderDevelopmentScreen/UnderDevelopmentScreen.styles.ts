import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference exists for this placeholder; it shares the inner
 * screens' PageHeader so the lockup and title hold their place.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;

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
      // Shared by every screen, so the brand lockup sits at the same height.
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
      paddingBottom: NAV_BAR_CLEARANCE + theme.spacing.md,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
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
