import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH, clamp } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen7.png), exported at
 * 611px for a 390dp frame (1.567px per dp). Its header and bottom
 * bar sit where Maintenance's do, so the rhythm is Maintenance's: the spacing
 * between and inside the cards is roomier than the reference, which packs
 * them almost edge to edge. Sizes and colours follow the reference; the type
 * is My Unit's, shared by the inner screens.
 */
/** My Unit's gutter, so the cards span its width (358dp at 390dp). */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const CARD_GAP = 18;

/** Content width the tiles and action labels were fitted to: a 390dp frame. */
const FITTED_CONTENT_WIDTH = 320;

/**
 * Where the content is narrower than the tiles were fitted to, they shrink in
 * step, so every label keeps its lines rather than wrapping further. Wider
 * screens keep the reference size.
 */
export function contentScaleFor(windowWidth: number): number {
  const content = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * GUTTER;
  return clamp(content / FITTED_CONTENT_WIDTH, 0.85, 1);
}

const HEADER_TO_BANNER = 30;

/** Taller than the shared banner's 116dp, for this screen's three-line body. */
export const BANNER_HEIGHT = 128;

/** Heading glyphs, and the parking sign drawn at the same visual size. */
export const HEADING_ICON_SIZE = 19;
export const HEADING_SIGN_SIZE = 18;
/** "Active", sized to its label like the reference's chip. */
const SLOT_CHIP_WIDTH = 58;

/** Four tiles across, as drawn: 6.4dp apart. */
const STAT_GAP = 6.4;
export const STAT_ICON_SIZE = 16;

/**
 * Three buttons across, drawn 99, 109 and 99.6dp wide: the middle one fits
 * "Guest Parking". The first gives the last 2dp, so "New Vehicle" keeps one
 * line in Inter down to 360dp screens.
 */
export const ACTION_WEIGHTS = [97, 109, 102] as const;
export const ACTION_HEIGHT = 44;
export const ACTION_RADIUS = 8;
const ACTION_GAP = 7.5;
export const ACTION_ICON_SIZE = 18;

/** The glyphs inside the list badges. */
export const ROW_ICON_SIZE = 16;
const LIST_BOTTOM = 6;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
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
    flex: {
      flex: 1,
    },

    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },
    card: {
      marginBottom: CARD_GAP,
    },

    slotChip: {
      width: SLOT_CHIP_WIDTH,
    },

    stats: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: STAT_GAP,
    },

    actions: {
      flexDirection: 'row',
      gap: ACTION_GAP,
    },
    // The design's lit buttons: a bright rim and a glow in their own colour.
    actionBlue: {
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.electricCyan,
      ...theme.shadows.glow,
    },
    actionViolet: {
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.actionVioletStroke,
      ...theme.shadows.glow,
      shadowColor: theme.colors.violet,
    },

    list: {
      paddingBottom: LIST_BOTTOM,
    },
  });
}
