import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Not in the Figma exports. Laid out on the inner screens' shared rhythm
 * (Maintenance's): My Unit's 16dp gutter, the header drawn for 35dp, 30dp
 * from header to the first card and 18dp between cards, panels inset 14dp.
 * A focused setup task, so no bottom bar.
 */
const GUTTER = 16;
const HEADER_GUTTER = 35;
const HEADER_TO_STEPPER = 24;
const STEPPER_TO_CARD = 22;
const CARD_GAP = 18;
const PANEL_INSET = 14;
const BOTTOM_SPACE = 40;

/** The CTA and secondary buttons, Maintenance's 42dp actions. */
export const ACTION_HEIGHT = 42;
export const ACTION_RADIUS = 10;
export const FIELD_HEIGHT = 44;
export const NOTE_ICON_SIZE = 17;
export const ROW_ICON_SIZE = 18;

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
      paddingBottom: BOTTOM_SPACE,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_STEPPER,
    },
    cancel: {
      paddingVertical: theme.spacing.xs,
    },
    stepper: {
      marginBottom: STEPPER_TO_CARD,
    },
    card: {
      marginBottom: CARD_GAP,
    },
    panel: {
      padding: PANEL_INSET,
    },
    panelTight: {
      paddingBottom: PANEL_INSET,
    },
    panelBody: {
      paddingHorizontal: PANEL_INSET,
    },
    sectionTitle: {
      marginBottom: theme.spacing.xs,
    },
    gapTop: {
      marginTop: theme.spacing.md,
    },
    gapTopSmall: {
      marginTop: theme.spacing.sm,
    },

    actions: {
      gap: theme.spacing.sm + 4,
    },
    actionRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm + 4,
    },
    actionCell: {
      flex: 1,
    },
    outline: {
      height: ACTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    link: {
      alignSelf: 'center',
      paddingVertical: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.6,
    },

    // A tinted callout: an error, a warning, or a neutral note.
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      padding: theme.spacing.sm + 4,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
    },
    noticeError: {
      backgroundColor: theme.colors.errorFill,
      borderColor: theme.colors.errorStroke,
    },
    noticeWarning: {
      backgroundColor: theme.colors.warningFill,
      borderColor: theme.colors.warningStroke,
    },
    noticeInfo: {
      backgroundColor: theme.colors.infoFill,
      borderColor: theme.colors.infoStroke,
    },
    noticeSuccess: {
      backgroundColor: theme.colors.successFill,
      borderColor: theme.colors.successStroke,
    },
    noticeText: {
      flex: 1,
      gap: 2,
    },
    noticeActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      // TextAction carries its own vertical padding.
      marginTop: 0,
    },

    // Selectable rows: nearby hotspots and server choices.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + 4,
      paddingVertical: theme.spacing.sm + 4,
      paddingHorizontal: theme.spacing.sm + 4,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    optionSelected: {
      borderColor: theme.colors.electricCyan,
      backgroundColor: theme.colors.infoFill,
    },
    optionText: {
      flex: 1,
    },
    optionList: {
      gap: theme.spacing.sm,
    },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    portRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    hostField: {
      flex: 3,
    },
    portField: {
      flex: 1,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
      marginVertical: theme.spacing.md,
    },
  });
}
