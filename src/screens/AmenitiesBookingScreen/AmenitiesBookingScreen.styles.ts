import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen11.png), exported at
 * 816px for a 390dp frame (2.092px per dp). The cards span My Unit's width
 * (a 16dp gutter), as on the other inner screens, and the vertical rhythm is
 * theirs: roomier than the reference, which packs the cards almost edge to
 * edge. Sizes and colours follow the reference; the type is My Unit's.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_BANNER = 30;

/** The banner, drawn 100dp tall, its two lines centred in it. */
export const BANNER_HEIGHT = 112;

/** Category chips, drawn 34dp tall and 7dp apart, sharing the row equally. */
const BANNER_TO_CHIPS = 18;
const CHIP_GAP = 8;
const CHIPS_TO_LIST = 18;

/** Amenity cards, drawn 6dp apart; a little more here. */
const CARD_GAP = 12;
const LIST_TO_MORE = 24;

/** "View More Amenities", drawn 184 x 32dp. */
const MORE_WIDTH = 196;
const MORE_HEIGHT = 36;
const MORE_INSET = 18;
export const MORE_CHEVRON_SIZE = 12;

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
      // Clears the pinned bottom bar so the last control scrolls fully into view.
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },
    // FeatureBanner pads from the top for its indicator; with none, the text is centred.
    banner: {
      paddingTop: 0,
      justifyContent: 'center',
    },

    chips: {
      flexDirection: 'row',
      gap: CHIP_GAP,
      marginTop: BANNER_TO_CHIPS,
      marginBottom: CHIPS_TO_LIST,
    },
    chip: {
      flex: 1,
    },

    list: {
      gap: CARD_GAP,
    },
    empty: {
      paddingVertical: theme.spacing.lg,
    },

    more: {
      alignSelf: 'center',
      width: MORE_WIDTH,
      height: MORE_HEIGHT,
      marginTop: LIST_TO_MORE,
    },
    moreSurface: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: MORE_INSET,
    },
    moreLabel: {
      flex: 1,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
