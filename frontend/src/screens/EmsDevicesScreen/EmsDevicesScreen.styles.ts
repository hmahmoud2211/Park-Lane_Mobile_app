import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { layout } from '../../theme';

/**
 * No Figma reference: built on the inner screens' shared frame, My Unit's
 * 16dp gutter and Maintenance's 44/30/18 rhythm, with NeonPanels and
 * PanelHeadings as on Smart Home.
 */
const GUTTER = layout.innerScreen.gutter;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_CONTENT = layout.innerScreen.headerToContent;
export const CARD_GAP = layout.innerScreen.cardGap;
const PANEL_INSET = layout.innerScreen.panelInset;
const ROW_GAP = 12;
export const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;
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
    account: {
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    accountActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    accountAction: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
    live: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
  });
}
