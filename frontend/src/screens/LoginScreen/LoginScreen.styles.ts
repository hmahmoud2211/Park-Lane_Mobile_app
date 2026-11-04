import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/**
 * Vertical rhythm measured from the Figma screen (assets/Screens/Screen 2.jpeg),
 * whose frame is 390 x 792 with a 47dp status bar. Values below are gaps
 * between elements, so the layout keeps its proportions on taller devices.
 */
const LOCKUP_TOP = 34;
const LOCKUP_WIDTH = 118;
const LOCKUP_HEIGHT = 36;
const LOCKUP_TO_HEADING = 60;
const HEADING_TO_SUBTITLE = 2;
const SUBTITLE_TO_FORM = 22;
const FIELD_GAP = 14;
const FIELD_TO_FORGOT = 7;
const FORGOT_TO_SUBMIT = 12;
const SUBMIT_TO_DIVIDER = 24;
const DIVIDER_TO_METHODS = 24;

/** Field and control geometry, also measured from the reference. */
const FORM_WIDTH = 256;
const METHOD_CARD_SIZE = 63;
const METHOD_CARD_GAP = 32;

/** Consumed by the screen, which passes them to shared components. */
export const BACK_BUTTON_SIZE = 36;
export const FIELD_HEIGHT = 40;
export const SUBMIT_HEIGHT = 34;

/**
 * Tablets and desktops: the form sits on a glass card, centred and capped,
 * with the fields filling it and the controls a size up from the phone's.
 */
const CARD_MAX_WIDTH = 440;
/**
 * The login photo (941 x 1672) is portrait, with the Park Lane gate along its
 * bottom. Tablets and desktops pin that edge to the screen's so the gate shows
 * behind the card, rather than the centre crop's empty sky.
 */
export const BACKGROUND_ASPECT = 941 / 1672;
/** The lit sign then sits behind the card; a light dimming keeps the form legible. */
export const BACKGROUND_OVERLAY_WIDE = 0.3;
const CARD_PADDING = 40;
export const FIELD_HEIGHT_WIDE = 48;
export const SUBMIT_HEIGHT_WIDE = 46;
const METHOD_CARD_SIZE_WIDE = 76;

export function createStyles(theme: AppTheme, isWide: boolean) {
  const formWidth = isWide ? '100%' : FORM_WIDTH;
  const methodSize = isWide ? METHOD_CARD_SIZE_WIDE : METHOD_CARD_SIZE;

  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      paddingTop: LOCKUP_TOP,
      paddingBottom: theme.spacing.xxl,
      ...(isWide && { width: '100%', maxWidth: theme.layout.contentMaxWidth.laptop, alignSelf: 'center' }),
    },
    card: {
      width: '100%',
      maxWidth: CARD_MAX_WIDTH,
      padding: CARD_PADDING,
      alignItems: 'center',
      borderRadius: theme.borderRadius.xl,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      backgroundColor: theme.colors.bubbleFill,
      // Centred in the room left under the lockup.
      marginVertical: 'auto',
    },

    lockupRow: {
      width: '100%',
      height: LOCKUP_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: isWide ? theme.spacing.xl : LOCKUP_TO_HEADING,
    },
    lockup: {
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
    },
    backButton: {
      position: 'absolute',
      left: 0,
      zIndex: 1,
    },

    heading: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      marginBottom: HEADING_TO_SUBTITLE,
    },
    headingGap: {
      width: 7,
    },
    subtitle: {
      marginBottom: SUBTITLE_TO_FORM,
    },

    form: {
      width: formWidth,
      maxWidth: '100%',
    },
    fieldGap: {
      marginTop: FIELD_GAP,
    },
    forgotPassword: {
      alignSelf: 'flex-end',
      marginTop: FIELD_TO_FORGOT,
      // Widens the tap target without moving the label.
      paddingVertical: theme.spacing.xs,
    },
    submit: {
      marginTop: FORGOT_TO_SUBMIT,
    },

    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: formWidth,
      maxWidth: '100%',
      marginTop: SUBMIT_TO_DIVIDER,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.divider,
    },
    dividerLabel: {
      paddingHorizontal: theme.spacing.md,
    },

    methods: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: DIVIDER_TO_METHODS,
    },
    methodCard: {
      width: methodSize,
      height: methodSize,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    methodGap: {
      marginLeft: METHOD_CARD_GAP,
    },
    methodLabel: {
      marginTop: 6,
      textAlign: 'center',
    },
  });
}
