import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen12.png), exported at
 * 793px for a 390dp frame (2.033px per dp). The cards span My Unit's width
 * (a 16dp gutter), as on the other inner screens, and the vertical rhythm is
 * theirs: roomier than the reference, which sets the cards 8dp apart. Sizes
 * and colours follow the reference; the type is My Unit's.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_LIST = 30;
const CARD_GAP = 12;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      // Shared by every screen, so the brand lockup sits at the same height.
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
      // Clears the pinned bottom bar so the last card scrolls fully into view.
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_LIST,
    },
    list: {
      gap: CARD_GAP,
    },
  });
}
