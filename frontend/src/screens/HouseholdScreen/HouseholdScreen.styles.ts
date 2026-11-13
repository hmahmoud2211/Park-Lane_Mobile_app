import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import { layout } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/** No Figma reference: the inner screens' frame (16dp gutter, 44/30/18 rhythm, NeonPanels), as on My Devices. */
const GUTTER = layout.innerScreen.gutter;
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_CONTENT = layout.innerScreen.headerToContent;
const CARD_GAP = layout.innerScreen.cardGap;
const PANEL_INSET = layout.innerScreen.panelInset;
const ROW_GAP = 12;
const ITEM_PADDING = 12;
/** The code field: tall enough to read and tap easily. */
export const FIELD_HEIGHT = 56;
export const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;
/** Secondary actions in a row still meet the 44dp touch target. */
export const SMALL_BUTTON_HEIGHT = 44;
/** Large enough for a phone camera to read at arm's length. */
export const QR_SIZE = 168;
const QR_PADDING = 12;

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
    divider: {
      height: theme.glass.strokeWidth,
      backgroundColor: theme.colors.dividerSubtle,
    },
    qrFrame: {
      alignSelf: 'center',
      padding: QR_PADDING,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.white,
    },
  });
}
