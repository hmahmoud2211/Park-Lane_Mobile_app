import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { layout } from '../../theme';

/**
 * No Figma reference: the same frame as My Devices and Connect Devices (16dp
 * gutter, 44/30/18 rhythm, NeonPanels with PanelHeadings), with brand rows
 * drawn like Connect Devices' brand list.
 */
const GUTTER = layout.innerScreen.gutter;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_CONTENT = layout.innerScreen.headerToContent;
export const CARD_GAP = layout.innerScreen.cardGap;
const PANEL_INSET = layout.innerScreen.panelInset;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 50;
export const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;
const BRAND_PADDING = 12;
/** Narrowest a brand row gets beside another; phones show one column. */
export const MIN_BRAND_WIDTH = 300;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
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
    brand: {
      padding: BRAND_PADDING,
      gap: theme.spacing.sm,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    brandText: {
      flex: 1,
      gap: 2,
    },
    pressed: {
      opacity: 0.7,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    action: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
  });
}
