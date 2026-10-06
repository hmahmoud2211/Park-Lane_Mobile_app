import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH, clamp } from '../../utils/responsive';

/**
 * Element sizes are measured from the Figma screen (assets/Screens/screen4.png),
 * exported at 812px for a 390dp frame (2.082px per dp). The spacing between
 * and inside the cards is deliberately roomier than that reference, which
 * packed the cards almost edge to edge.
 */
const GUTTER = 16;
const CARD_GAP = 14;

/** Matches Home and Profile, so the header holds its line between screens. */
const HEADER_TOP = 28;
/** Back arrow, title and "…" share this row; the lockup overhangs it. */
const HEADER_HEIGHT = 68;
const HEADER_ROW_HEIGHT = 38;
const HEADER_INSET_LEFT = 8;
const HEADER_INSET_RIGHT = 7;
const LOCKUP_WIDTH = 102;
const LOCKUP_HEIGHT = 50;
const MORE_SIZE = 22;

/**
 * Column widths for each figure row, taken from where the reference draws its
 * separators, then nudged so each column's longest Inter figure fits on one
 * line at 390dp. `gap` is the space on either side of a separator.
 */
export const columns = {
  // The hero card sets its own separator gap.
  hero: { weights: [63, 70, 76, 70] },
  overview: { weights: [95, 75, 95], gap: 18 },
  financial: { weights: [93, 90, 81], gap: 16 },
  maintenance: { weights: [56, 51, 52, 85], gap: 14 },
  utilities: { weights: [96, 90, 85], gap: 11 },
} as const;

/**
 * Inside width of a card when the figure rows were fitted to the reference:
 * a 390dp frame, 10dp gutter and 16dp card padding.
 */
const FITTED_CARD_INNER_WIDTH = 338;

/**
 * Where a card is narrower inside than the rows were fitted to, the rows
 * shrink in step, so every value keeps its one-line layout rather than
 * truncating. Wider cards keep the reference size.
 */
export function statScaleFor(windowWidth: number, theme: AppTheme): number {
  const inner = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * (GUTTER + theme.spacing.md);
  return clamp(inner / FITTED_CARD_INNER_WIDTH, 0.8, 1);
}

export const UTILITY_ICON_SIZE = 22;
export const UTILITY_ICON_GAP = 9;

/** Documents: three tiles across, inset a little less than the other bodies. */
const DOCUMENTS_INSET = 12;
const DOCUMENT_GAP = 8;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: HEADER_TOP,
      paddingHorizontal: GUTTER,
      // Clears the pinned bottom bar so the last card scrolls fully into view.
      paddingBottom: NAV_BAR_CLEARANCE + CARD_GAP,
    },

    header: {
      height: HEADER_HEIGHT,
    },
    headerRow: {
      height: HEADER_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: HEADER_INSET_LEFT,
      paddingRight: HEADER_INSET_RIGHT,
    },
    headerTitle: {
      flex: 1,
    },
    lockupFrame: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    lockup: {
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
    },
    more: {
      width: MORE_SIZE,
      height: MORE_SIZE,
      borderRadius: MORE_SIZE / 2,
      borderWidth: 1.5,
      borderColor: theme.colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.6,
    },

    card: {
      marginBottom: CARD_GAP,
    },

    overviewColumn: {
      gap: 14,
    },

    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 14,
    },
    progressBar: {
      flex: 1,
      marginRight: 12,
    },
    financialDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
      marginTop: 14,
      marginBottom: 14,
    },

    documentsBody: {
      flexDirection: 'row',
      gap: DOCUMENT_GAP,
      paddingTop: 2,
      paddingBottom: theme.spacing.md,
      paddingHorizontal: DOCUMENTS_INSET,
    },
    documentTile: {
      flex: 1,
    },
  });
}
