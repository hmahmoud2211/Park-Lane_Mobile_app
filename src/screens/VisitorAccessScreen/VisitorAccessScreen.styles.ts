import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen5.png), exported at
 * 791px for a 390dp frame (2.028px per dp). Its wordmark sits exactly where
 * the home reference's does, so the header shares Home's 28dp top.
 *
 * As on My Unit, the spacing between and inside the cards is deliberately
 * roomier than the reference, which packed them almost edge to edge. Sizes,
 * type and the card width still follow the reference.
 */
const GUTTER = 35;
/** Matches My Unit's gap between cards. */
const CARD_GAP = 14;

/** Matches Home, so the wordmark holds its place between the two screens. */
const HEADER_TOP = 28;
const LOCKUP_WIDTH = 132;
const LOCKUP_HEIGHT = 40;
/** The back label and menu sit 10dp below the header top, above the lockup's middle. */
const HEADER_ROW_HEIGHT = 20;
/** Pulls the chevron's glyph, not its box, onto the 37dp line. */
const HEADER_INSET_LEFT = -1.5;
const MENU_INSET_RIGHT = 12;
const HEADER_TO_BANNER = 24;

export const MENU_ICON_SIZE = 24;

/**
 * Banner: the photo runs the full height at its own aspect ratio (411 x 195),
 * so the sign at its right edge is never cropped; its left side sits under
 * the text's fade.
 */
const BANNER_HEIGHT = 116;
const BANNER_PHOTO_ASPECT = 411 / 195;
const BANNER_PHOTO_WIDTH = Math.round(BANNER_HEIGHT * BANNER_PHOTO_ASPECT);
const BANNER_INSET_LEFT = 18;
const BANNER_INSET_TOP = 22;
const BANNER_BODY_TOP = 6;
const INDICATOR_TOP = 14;
const INDICATOR_WIDTH = 30.5;
const INDICATOR_ACTIVE_WIDTH = 18;
const INDICATOR_HEIGHT = 2.5;

/**
 * Form card: a 2 x 3 grid of 38dp fields, 12dp in from the card edge. The
 * heading's icon centres over the fields' icons, and its title starts on the
 * fields' text line.
 */
const FORM_INSET = 12;
const FORM_HEADER_TOP = 14;
const FORM_ICON_LEFT = 5.5;
const FORM_ICON_BOX = 24;
const FORM_TITLE_LEFT = 8.5;
const FORM_HEADER_TO_FIELDS = 14;
export const FIELD_HEIGHT = 38;
const FIELD_GAP = 10;
export const FORM_ICON_SIZE = 23;
export const FIELD_CHEVRON_SIZE = 11;
const CTA_TOP = 16;
export const CTA_HEIGHT = 34;
const FORM_BOTTOM = 14;
export const CTA_ARROW_SIZE = 11;

/**
 * Upcoming card: a 38dp heading over the rows, 12dp in from the edge (see
 * VisitorRow). The "View All" chevron lines up with the rows' chevrons.
 */
const LIST_HEADER_HEIGHT = 38;
const LIST_ICON_LEFT = 10;
export const LIST_ICON_SIZE = 17;
const LIST_TITLE_LEFT = 14;
const LIST_INSET = 12;
const LIST_TOP = 4;
const LIST_BOTTOM = 8;
export const VIEW_ALL_CHEVRON_SIZE = 9;
const VIEW_ALL_RIGHT = 9.5;

/** Parking card: one 58dp row. */
const PARKING_HEIGHT = 58;
const PARKING_ICON_LEFT = 14;
/** The boxed "P" is drawn rather than taken from an icon set, whose strokes are heavier. */
const PARKING_BADGE_SIZE = 26;
const PARKING_TITLE_LEFT = 14;
export const PARKING_CHEVRON_SIZE = 14;
const PARKING_INSET_RIGHT = 8;

/** A taller, narrower glass bar than Home's, as drawn on this screen. */
const BOTTOM_BAR_HEIGHT = 72;
const BOTTOM_BAR_INSET = 40;
const BOTTOM_BAR_BOTTOM = 21;

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
      paddingBottom: BOTTOM_BAR_BOTTOM + BOTTOM_BAR_HEIGHT + 2 * CARD_GAP,
    },
    pressed: {
      opacity: 0.6,
    },

    header: {
      height: LOCKUP_HEIGHT,
      marginBottom: HEADER_TO_BANNER,
    },
    lockup: {
      alignSelf: 'center',
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
      tintColor: theme.colors.textPrimary,
    },
    headerRow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: HEADER_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginLeft: HEADER_INSET_LEFT,
      paddingRight: MENU_INSET_RIGHT,
    },

    card: {
      marginBottom: CARD_GAP,
    },
    panel: {
      backgroundColor: theme.colors.panelFill,
    },

    // Darker than the other cards: the page's own navy, which the photo fades into.
    banner: {
      backgroundColor: theme.colors.backgroundDeep,
      height: BANNER_HEIGHT,
      paddingLeft: BANNER_INSET_LEFT,
      paddingTop: BANNER_INSET_TOP,
    },
    // The glowing surface leaves children unclipped, so the photo carries its
    // own rounded clip.
    bannerMedia: {
      ...StyleSheet.absoluteFill,
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden',
    },
    bannerPhoto: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: BANNER_PHOTO_WIDTH,
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    bannerPhotoImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    bannerBody: {
      marginTop: BANNER_BODY_TOP,
    },
    indicator: {
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      borderRadius: INDICATOR_HEIGHT / 2,
      marginTop: INDICATOR_TOP,
      backgroundColor: theme.colors.dividerSubtle,
      overflow: 'hidden',
    },
    indicatorActive: {
      width: INDICATOR_ACTIVE_WIDTH,
      height: '100%',
      borderRadius: INDICATOR_HEIGHT / 2,
      backgroundColor: theme.colors.electricCyan,
    },

    form: {
      paddingHorizontal: FORM_INSET,
      paddingTop: FORM_HEADER_TOP,
      paddingBottom: FORM_BOTTOM,
    },
    formHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: FORM_HEADER_TO_FIELDS,
    },
    formIcon: {
      width: FORM_ICON_BOX,
      alignItems: 'center',
      marginLeft: FORM_ICON_LEFT,
      // The icon set puts the plus on the left; the design has it on the right.
      transform: [{ scaleX: -1 }],
    },
    formTitle: {
      flex: 1,
      marginLeft: FORM_TITLE_LEFT,
    },
    formSubtitle: {
      marginTop: 1.5,
    },
    grid: {
      gap: FIELD_GAP,
    },
    gridRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: FIELD_GAP,
    },
    gridItem: {
      flex: 1,
    },
    cta: {
      marginTop: CTA_TOP,
      // The pale rim around the gradient.
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      ...theme.shadows.glow,
    },

    list: {
      paddingBottom: LIST_BOTTOM,
    },
    listHeader: {
      height: LIST_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: LIST_ICON_LEFT,
      paddingRight: VIEW_ALL_RIGHT,
    },
    listTitle: {
      flex: 1,
      marginLeft: LIST_TITLE_LEFT,
    },
    viewAll: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    viewAllChevron: {
      marginLeft: 3,
    },
    // Overlaid on the heading's bottom edge, so it adds no height.
    listDivider: {
      position: 'absolute',
      top: LIST_HEADER_HEIGHT,
      left: LIST_INSET,
      right: LIST_INSET,
      height: StyleSheet.hairlineWidth,
      opacity: 0.45,
    },
    listRows: {
      marginTop: LIST_TOP,
    },

    parking: {
      height: PARKING_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: PARKING_ICON_LEFT,
      paddingRight: PARKING_INSET_RIGHT,
    },
    parkingBadge: {
      width: PARKING_BADGE_SIZE,
      height: PARKING_BADGE_SIZE,
      borderRadius: 4.5,
      borderWidth: 1.25,
      borderColor: theme.colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    parkingText: {
      flex: 1,
      marginLeft: PARKING_TITLE_LEFT,
      gap: 3,
    },

    bottomBar: {
      position: 'absolute',
      left: BOTTOM_BAR_INSET,
      right: BOTTOM_BAR_INSET,
      bottom: BOTTOM_BAR_BOTTOM,
    },
  });
}

export { BOTTOM_BAR_HEIGHT };
