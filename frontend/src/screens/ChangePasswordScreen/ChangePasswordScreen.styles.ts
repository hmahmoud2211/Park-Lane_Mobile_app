import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/**
 * No Figma reference: set as a sibling of the Login screen, with its measurements, so the step
 * reads as the end of signing in. No back button and no bottom bar: nothing else is open yet.
 */
const LOCKUP_TOP = 34;
const LOCKUP_WIDTH = 118;
const LOCKUP_HEIGHT = 36;
const LOCKUP_TO_HEADING = 60;
const HEADING_TO_SUBTITLE = 2;
const SUBTITLE_TO_FORM = 22;
const FIELD_GAP = 14;
const FIELD_TO_RULES = 7;
const RULES_TO_SUBMIT = 12;
const FORM_WIDTH = 256;
const CARD_MAX_WIDTH = 440;
const CARD_PADDING = 40;

export const FIELD_HEIGHT = 40;
export const SUBMIT_HEIGHT = 34;
export const FIELD_HEIGHT_WIDE = 48;
export const SUBMIT_HEIGHT_WIDE = 46;
export const BACKGROUND_ASPECT = 941 / 1672;
export const BACKGROUND_OVERLAY_WIDE = 0.3;
export const FIELD_ICON_SIZE = 17;

export function createStyles(theme: AppTheme, isWide: boolean) {
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
    card: isWide
      ? {
          width: '100%',
          maxWidth: CARD_MAX_WIDTH,
          padding: CARD_PADDING,
          alignItems: 'center',
          borderRadius: theme.borderRadius.xl,
          borderWidth: theme.glass.strokeWidth,
          borderColor: theme.colors.frameStroke,
          backgroundColor: theme.colors.bubbleFill,
          marginVertical: 'auto',
        }
      : {
          width: '100%',
          alignItems: 'center',
        },
    lockup: {
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
      marginBottom: isWide ? theme.spacing.xl : LOCKUP_TO_HEADING,
    },
    heading: {
      alignItems: 'center',
      marginBottom: HEADING_TO_SUBTITLE,
    },
    subtitle: {
      textAlign: 'center',
      width: isWide ? '100%' : FORM_WIDTH,
      maxWidth: '100%',
      marginBottom: SUBTITLE_TO_FORM,
    },
    form: {
      width: isWide ? '100%' : FORM_WIDTH,
      maxWidth: '100%',
    },
    signedInAs: {
      marginBottom: theme.spacing.sm,
    },
    fieldGap: {
      marginTop: FIELD_GAP,
    },
    rules: {
      marginTop: FIELD_TO_RULES,
    },
    formError: {
      marginTop: theme.spacing.sm,
    },
    submit: {
      marginTop: RULES_TO_SUBMIT,
    },
    link: {
      alignSelf: 'center',
      marginTop: theme.spacing.md,
      // Widens the tap target without moving the label.
      paddingVertical: theme.spacing.xs,
    },
  });
}
