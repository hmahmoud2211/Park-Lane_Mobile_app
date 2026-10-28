import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma reference: the same frame as My Devices (16dp gutter, 35dp
 * header, 18dp between panels, 14dp panel insets), with Smart Home's AC card
 * language for the set point (a blue minus ring and a violet plus ring either
 * side of the hero figure), drawn larger here as the screen's focus.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 30;
export const CARD_GAP = 18;
const PANEL_INSET = 14;
const ROW_GAP = 12;
const STEP_BUTTON_SIZE = 44;
export const STEP_ICON_SIZE = 22;
const STEP_STROKE = 1.5;
const SMALL_STEP_SIZE = 32;
export const SMALL_STEP_ICON_SIZE = 16;
export const ROW_ICON_SIZE = 18;
export const SMALL_BUTTON_HEIGHT = 36;
export const FILTER_BAR_HEIGHT = 9;
/** Wide enough for "10 h 45 min" without the stepper jumping as it changes. */
const STEPPER_VALUE_WIDTH = 84;

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
    group: {
      gap: theme.spacing.sm,
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    chips: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs + 2,
    },
    choices: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    inline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    setPointRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    stepButton: {
      width: STEP_BUTTON_SIZE,
      height: STEP_BUTTON_SIZE,
      borderRadius: STEP_BUTTON_SIZE / 2,
      borderWidth: STEP_STROKE,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The minus ring is lit blue, the plus ring violet, as on Smart Home's AC card.
    stepCool: {
      borderColor: theme.colors.neonBlue,
    },
    stepWarm: {
      borderColor: theme.colors.violet,
    },
    setPoint: {
      flex: 1,
    },
    readings: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    rowDivider: {
      paddingTop: ROW_GAP,
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing.xs,
    },
    smallStep: {
      width: SMALL_STEP_SIZE,
      height: SMALL_STEP_SIZE,
      borderRadius: SMALL_STEP_SIZE / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperValue: {
      width: STEPPER_VALUE_WIDTH,
    },
    reading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    dim: {
      opacity: 0.45,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
