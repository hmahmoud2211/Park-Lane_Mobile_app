import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference: built on the inner screens' shared frame, My Unit's
 * 16dp gutter and Maintenance's 44/30/18 rhythm, with NeonPanels and
 * PanelHeadings as on Smart Home.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 30;
export const CARD_GAP = 18;
const PANEL_INSET = 14;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 54;
export const BUTTON_HEIGHT = 46;
export const SMALL_BUTTON_HEIGHT = 36;
/** Narrowest a device card gets beside another; phones show one column. */
export const MIN_DEVICE_WIDTH = 300;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
      gap: CARD_GAP,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_CONTENT - CARD_GAP,
    },
    panel: {
      padding: PANEL_INSET,
      gap: ROW_GAP,
    },
    live: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    form: {
      gap: ROW_GAP,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    action: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
  });
}
