import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference: the same frame as My Devices (16dp gutter, 44/30/18
 * rhythm, NeonPanels with PanelHeadings).
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 30;
export const CARD_GAP = 18;
const PANEL_INSET = 14;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 54;
export const SMALL_BUTTON_HEIGHT = 36;
/** A button beside text has no width of its own to take. */
const INLINE_BUTTON_WIDTH = 112;

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
    form: {
      gap: ROW_GAP,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    action: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
    inlineButton: {
      width: INLINE_BUTTON_WIDTH,
    },
    factRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
  });
}
