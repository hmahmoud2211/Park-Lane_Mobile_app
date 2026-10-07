import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * No Figma frame exists for this screen yet. The header keeps the inner
 * screens' 35dp gutter so the back label and lockup hold their place; the
 * conversation below runs wider, as chat needs the room.
 */
const HEADER_GUTTER = 35;
const GUTTER = 20;
const TOOLBAR_GAP = 18;
const MODE_SWITCH_WIDTH = 164;

export const EMPTY_ORB_SIZE = 92;
export const VOICE_ORB_SIZE = 136;
export const VOICE_ORB_SIZE_COMPACT = 104;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    page: {
      flex: 1,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      // Shared by every screen, so the brand lockup sits at the same height.
      paddingTop: theme.spacing.headerTop,
    },
    header: {
      paddingHorizontal: HEADER_GUTTER,
      marginBottom: TOOLBAR_GAP,
    },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: GUTTER,
      gap: theme.spacing.sm,
    },
    modeSwitch: {
      width: MODE_SWITCH_WIDTH,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: GUTTER,
      marginTop: theme.spacing.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.errorFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.errorStroke,
    },
    bannerText: {
      flex: 1,
      marginHorizontal: 8,
    },
    bannerAction: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: theme.borderRadius.pill,
      backgroundColor: theme.colors.emergencyFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.errorStroke,
    },
    pane: {
      flex: 1,
      marginTop: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.7,
    },

    /* Chat */
    thread: {
      paddingHorizontal: GUTTER,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    threadEmpty: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    welcome: {
      paddingBottom: theme.spacing.md,
    },
    welcomeOrb: {
      alignSelf: 'center',
      marginBottom: theme.spacing.xs,
    },
    welcomeTitle: {
      marginTop: 2,
    },
    welcomeBody: {
      marginTop: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
    },
    composer: {
      marginHorizontal: GUTTER - 6,
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.md,
    },

    /* Voice */
    voice: {
      flex: 1,
      paddingHorizontal: GUTTER,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.lg,
    },
    voiceOrb: {
      alignSelf: 'center',
      marginTop: -theme.spacing.sm,
    },
    voiceHint: {
      marginTop: -theme.spacing.md,
      minHeight: 20,
    },
    voiceNotice: {
      marginTop: theme.spacing.xs,
    },
    voiceTranscript: {
      flex: 1,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    voiceIntro: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    voiceIntroBody: {
      marginTop: theme.spacing.sm,
    },
    voiceTry: {
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
    },
    voiceExamples: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    voiceExample: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: theme.borderRadius.pill,
      backgroundColor: theme.colors.bubbleFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
    },
    voiceNote: {
      marginTop: theme.spacing.md,
    },
    voiceControls: {
      marginTop: theme.spacing.sm,
    },
    camera: {
      position: 'absolute',
      top: theme.spacing.md,
      right: GUTTER,
    },
  });
}
