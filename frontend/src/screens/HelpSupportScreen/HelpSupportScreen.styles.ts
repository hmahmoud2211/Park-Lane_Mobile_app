import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import { layout } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/** No Figma reference: the Settings screen's measurements, with the inner screens' panels. */
const GUTTER = layout.innerScreen.gutter;
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_LIST = 30;
const CARD_GAP = 10;
const PANEL_PADDING = 18;

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
      marginBottom: HEADER_TO_LIST - CARD_GAP,
    },
    panel: {
      padding: PANEL_PADDING,
    },
    heading: {
      marginBottom: theme.spacing.xs,
    },
  });
}
