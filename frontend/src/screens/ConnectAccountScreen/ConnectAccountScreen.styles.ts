import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { layout } from '../../theme';

/**
 * No Figma reference: the same frame as My Devices (16dp gutter, 44/30/18
 * rhythm, NeonPanels with PanelHeadings).
 */
const GUTTER = layout.innerScreen.gutter;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_CONTENT = layout.innerScreen.headerToContent;
export const CARD_GAP = layout.innerScreen.cardGap;
const PANEL_INSET = layout.innerScreen.panelInset;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 54;
export const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;
export const QR_SIZE = 200;
const BRAND_PADDING = 12;

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
    brands: {
      gap: theme.spacing.sm,
    },
    brand: {
      padding: BRAND_PADDING,
      gap: theme.spacing.xs,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.7,
    },
    dim: {
      opacity: 0.5,
    },
    form: {
      gap: ROW_GAP,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    qr: {
      alignSelf: 'center',
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.qrBackground,
    },
    center: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.md,
    },
  });
}
