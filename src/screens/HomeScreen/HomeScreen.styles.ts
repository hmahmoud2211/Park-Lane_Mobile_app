import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/**
 * Vertical rhythm measured from the Figma screen (assets/Screens/screen3.jpg),
 * whose frame is 390 x 818 with a 36dp gutter.
 */
const HEADER_TOP = 28;
const HEADER_TO_GREETING = 26;
const GREETING_TO_UNIT = 30;
const UNIT_TO_GRID = 31;
const PROMO_TOP = 16;

/** Two columns inside a 36dp gutter: 150 + 18 + 150 = 318. */
export const TILE_GAP = 18;
export const TILE_ROW_GAP = 10;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      paddingTop: HEADER_TOP,
      // Clears the pinned bottom bar so the promo card is fully scrollable.
      paddingBottom: 104,
    },

    header: {
      marginBottom: HEADER_TO_GREETING,
    },

    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: GREETING_TO_UNIT,
    },
    greetingText: {
      flex: 1,
      paddingRight: theme.spacing.md,
    },
    tagline: {
      marginTop: 2,
    },

    unitCard: {
      marginBottom: UNIT_TO_GRID,
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // Negative outer margins let each tile carry its own gap.
      marginHorizontal: -TILE_GAP / 2,
      marginBottom: PROMO_TOP,
    },
    gridItem: {
      width: '50%',
      paddingHorizontal: TILE_GAP / 2,
      marginBottom: TILE_ROW_GAP,
    },

    bottomBar: {
      position: 'absolute',
      // Wider than the content gutter, matching the reference.
      left: -theme.spacing.md,
      right: -theme.spacing.md,
      bottom: theme.spacing.md,
    },
  });
}
