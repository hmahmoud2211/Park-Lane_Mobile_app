import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/**
 * Vertical rhythm measured from the Figma screen (assets/Screens/Screen 2.jpeg),
 * whose frame is 390 x 792 with a 47dp status bar. Values below are gaps
 * between elements, so the layout keeps its proportions on taller devices.
 */
const LOCKUP_TOP = 14;
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
export const FIELD_HEIGHT = 40;
export const SUBMIT_HEIGHT = 34;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      paddingTop: LOCKUP_TOP,
      paddingBottom: theme.spacing.xxl,
    },

    lockup: {
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
      marginBottom: LOCKUP_TO_HEADING,
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
      width: FORM_WIDTH,
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

    notice: {
      marginTop: theme.spacing.md,
    },

    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: FORM_WIDTH,
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
      width: METHOD_CARD_SIZE,
      height: METHOD_CARD_SIZE,
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
