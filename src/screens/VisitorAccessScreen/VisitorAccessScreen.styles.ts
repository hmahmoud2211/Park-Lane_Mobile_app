import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen5.png), exported at
 * 791px for a 390dp frame (2.028px per dp). Its wordmark sits exactly where
 * the home reference's does, so the header shares Home's 28dp top.
 *
 * As on My Unit, the spacing between and inside the cards is deliberately
 * roomier than the reference, which packed them almost edge to edge. Sizes
 * follow the reference; the cards span My Unit's width; the type is My Unit's.
 */
/** My Unit's gutter, so the cards span its width (358dp at 390dp). */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
/** Matches My Unit's gap between cards. */
const CARD_GAP = 14;

/** Matches Home, so the wordmark holds its place between the two screens. */
const HEADER_TOP = 28;
const HEADER_TO_BANNER = 24;

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

/** Upcoming card: the rows (see VisitorRow) under a PanelHeading. */
const LIST_TOP = 4;
const LIST_BOTTOM = 8;

/** Parking card: one 58dp row. */
const PARKING_HEIGHT = 58;
const PARKING_ICON_LEFT = 14;
/** The boxed "P" is drawn rather than taken from an icon set, whose strokes are heavier. */
const PARKING_BADGE_SIZE = 26;
const PARKING_TITLE_LEFT = 14;
export const PARKING_CHEVRON_SIZE = 14;
const PARKING_INSET_RIGHT = 8;

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
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
    },
    pressed: {
      opacity: 0.6,
    },

    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },

    card: {
      marginBottom: CARD_GAP,
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
  });
}

