import { StyleSheet } from 'react-native';

import { HALO_SPAN } from '../../components/assistant/AssistantOrb';
import { spacing } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH, clamp } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen14.png), exported at
 * 761px for a 390dp frame (1.951px per dp), which draws the chat's welcome
 * state. The header keeps the inner screens' 35dp gutter so the back ring and
 * lockup hold their place; everything below sits inside the theme's screen
 * gutter, so every frame is as wide as Home's cards.
 * Colours follow the reference; the type is My Unit's. The frames are drawn
 * more compact than the reference, and the screen has no bottom bar: chat
 * gets the full height.
 */
const HEADER_GUTTER = 35;
/** Home's gutter: 318dp frames at 390dp. */
const GUTTER = spacing.screenGutter;
const TOOLBAR_GAP = 18;
const MODE_SWITCH_WIDTH = 156;

/**
 * The welcome card: the orb's box 12dp in, the greeting 4dp beyond it, the
 * card as tall as the orb's halo.
 */
const HERO_PADDING_VERTICAL = 12;
const HERO_ORB_INSET = 12;
const HERO_TEXT_GAP = 4;
const HERO_PADDING_RIGHT = 13;
/** The greeting column never narrows past this; the orb shrinks instead. */
const HERO_TEXT_MIN = 150;
/** The orb core; its halo spans `HALO_SPAN` times this. */
const EMPTY_ORB_MAX = 72;
/** Small enough that a 320dp phone keeps the intro's line breaks. */
const EMPTY_ORB_MIN = 44;
/** Space above the welcome card, and between the suggestions and the composer. */
const WELCOME_TOP = 18;
const WELCOME_BOTTOM = 14;

/**
 * The welcome orb at its full size wherever the card leaves the greeting
 * room, and smaller on narrow phones.
 */
export function emptyOrbSizeFor(windowWidth: number): number {
  const card = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * GUTTER;
  const room = card - HERO_ORB_INSET - HERO_TEXT_GAP - HERO_PADDING_RIGHT - HERO_TEXT_MIN;
  return Math.round(clamp(room / HALO_SPAN, EMPTY_ORB_MIN, EMPTY_ORB_MAX));
}
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
    // Takes what the resident chip leaves, up to its drawn width, so a narrow
    // phone narrows the switch rather than truncating the name.
    modeSwitch: {
      flex: 1,
      maxWidth: MODE_SWITCH_WIDTH,
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
      paddingTop: WELCOME_TOP,
    },
    // The card at the top and the suggestions at the bottom, the backdrop
    // showing between them as in the design.
    welcome: {
      flex: 1,
      justifyContent: 'space-between',
      gap: theme.spacing.lg,
      paddingBottom: WELCOME_BOTTOM,
    },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: HERO_PADDING_VERTICAL,
      paddingLeft: HERO_ORB_INSET,
      paddingRight: HERO_PADDING_RIGHT,
    },
    heroText: {
      flex: 1,
      marginLeft: HERO_TEXT_GAP,
    },
    heroTitle: {
      marginTop: 2,
    },
    heroBody: {
      marginTop: theme.spacing.sm,
    },
    composer: {
      marginHorizontal: GUTTER,
      marginTop: theme.spacing.xs,
      // Lifts the field off the bottom edge, on top of the safe-area inset.
      marginBottom: theme.spacing.xl,
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
      marginTop: theme.spacing.xs,
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
    voiceIntroScroll: {
      flex: 1,
      marginTop: theme.spacing.sm,
    },
    // Centred while it fits; once it does not, it scrolls from the top.
    voiceIntroContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingVertical: theme.spacing.sm,
    },
    voiceIntro: {
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
