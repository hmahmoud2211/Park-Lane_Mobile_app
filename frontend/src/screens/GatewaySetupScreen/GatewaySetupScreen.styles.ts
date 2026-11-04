import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { layout } from '../../theme';

/** No Figma reference: the My Devices frame (16dp gutter, 44/30/18 rhythm, NeonPanels). */
const GUTTER = layout.innerScreen.gutter;
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_CONTENT = layout.innerScreen.headerToContent;
export const CARD_GAP = layout.innerScreen.cardGap;
const PANEL_INSET = layout.innerScreen.panelInset;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 54;
export const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;
export const SMALL_BUTTON_HEIGHT = 36;
export const PROGRESS_HEIGHT = 6;
const ITEM_PADDING = 12;

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
    item: {
      padding: ITEM_PADDING,
      gap: theme.spacing.sm,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    action: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    divider: {
      height: theme.glass.strokeWidth,
      backgroundColor: theme.colors.dividerSubtle,
    },
  });
}
