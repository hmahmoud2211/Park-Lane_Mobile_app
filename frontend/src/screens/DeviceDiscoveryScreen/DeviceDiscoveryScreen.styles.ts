import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/** No Figma reference: the Add Device frame (16dp gutter, 44/30/18 rhythm, NeonPanels). */
const GUTTER = 16;
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 30;
export const CARD_GAP = 18;
const PANEL_INSET = 14;
const ROW_GAP = 12;
export const FIELD_HEIGHT = 54;
export const BUTTON_HEIGHT = 46;
export const SMALL_BUTTON_HEIGHT = 36;
export const PROGRESS_HEIGHT = 6;
const CANDIDATE_PADDING = 12;

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
    candidate: {
      padding: CANDIDATE_PADDING,
      gap: theme.spacing.sm,
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    pressed: {
      opacity: 0.7,
    },
    dim: {
      opacity: 0.6,
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
    center: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
    },
  });
}
