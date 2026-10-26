import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference: the inner screens' shared frame (16dp gutter, the
 * 44/30/18 rhythm), NeonPanels and PanelHeadings, as on My Devices.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 30;
const CARD_GAP = 18;
const PANEL_INSET = 14;
const ROW_GAP = 12;
export const BUTTON_HEIGHT = 46;
export const SMALL_BUTTON_HEIGHT = 34;

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
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    details: {
      gap: theme.spacing.xs,
    },
    buttons: {
      gap: theme.spacing.sm + 2,
    },
    examples: {
      gap: ROW_GAP,
    },
    example: {
      gap: theme.spacing.xs,
    },
    rtl: {
      writingDirection: 'rtl',
      textAlign: 'right',
    },
    accessRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    accessText: {
      flex: 1,
      gap: 2,
    },
    tip: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
  });
}
