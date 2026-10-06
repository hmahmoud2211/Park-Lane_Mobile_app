import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen8.png), exported at
 * 793px for a 390dp frame (2.033px per dp). Its header and bottom
 * bar sit where Maintenance's and Parking's do, so the rhythm is theirs: the
 * spacing between and inside the cards is roomier than the reference, which
 * packs them almost edge to edge. Sizes and colours follow the reference; the
 * type is My Unit's, shared by the inner screens.
 */
/** My Unit's gutter, so the cards span its width (358dp at 390dp). */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const CARD_GAP = 18;

/** As on Maintenance and Parking: extra room above the header; Home's sits at 28. */
const HEADER_TOP = 44;
const HEADER_TO_BANNER = 30;

/** Parking's banner height, for the same three-line body. */
export const BANNER_HEIGHT = 128;

export const HEADING_ICON_SIZE = 19;

/** Announcement and alert thumbnails, drawn 60 x 34 and 60 x 28. */
export const ANNOUNCEMENT_PHOTO = { width: 60, height: 34 } as const;
export const ALERT_PHOTO = { width: 60, height: 30 } as const;

/**
 * Event thumbnails, drawn 69 x 33. Narrower here: Inter is wider than the
 * design face, and the titles need the room to keep one line.
 */
export const EVENT_PHOTO = { width: 54, height: 32 } as const;
/** "05 / OCT", with a faint rule on its right as drawn. */
export const DATE_COLUMN_WIDTH = 26;
/** The RSVP pill, sized to "Coming Soon" in Inter. */
const RSVP_WIDTH = 70;

/** The rounded badge over an alert's photo. */
const ALERT_BADGE_WIDTH = 24;
const ALERT_BADGE_HEIGHT = 20;
const ALERT_BADGE_INSET = 3;
export const ALERT_BADGE_ICON_SIZE = 12;

const POLL_BOTTOM = 8;
const LIST_BOTTOM = 6;

/**
 * Resident Feedback: photo, text, then the button, drawn 52 x 33 and 85 x 22.
 * The photo gives up a little width so the title keeps one line in Inter.
 */
const FEEDBACK_INSET = 12;
export const FEEDBACK_PHOTO = { width: 46, height: 34 } as const;
const FEEDBACK_PHOTO_TO_TEXT = 10;
const FEEDBACK_TEXT_TO_BUTTON = 6;
const FEEDBACK_ICON_INSET = 2;
export const FEEDBACK_ICON_SIZE = 15;
const FEEDBACK_BODY_TOP = 3;
/** Taller than drawn, so the tap target and Inter's wider label fit. */
export const FEEDBACK_BUTTON_HEIGHT = 26;
const FEEDBACK_BUTTON_WIDTH = 98;
export const FEEDBACK_CHEVRON_SIZE = 10;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: HEADER_TOP,
      paddingHorizontal: GUTTER,
      // Clears the pinned bottom bar so the last card scrolls fully into view.
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
    },
    flex: {
      flex: 1,
    },

    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },
    card: {
      marginBottom: CARD_GAP,
    },
    list: {
      paddingBottom: LIST_BOTTOM,
    },
    poll: {
      paddingBottom: POLL_BOTTOM,
    },

    dateColumn: {
      width: DATE_COLUMN_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.dividerSubtle,
      paddingRight: theme.spacing.xs,
    },
    rsvp: {
      width: RSVP_WIDTH,
    },
    pillPressed: {
      opacity: 0.7,
    },

    alertBadge: {
      width: ALERT_BADGE_WIDTH,
      height: ALERT_BADGE_HEIGHT,
      marginLeft: ALERT_BADGE_INSET,
      borderRadius: theme.borderRadius.sm,
      borderWidth: theme.glass.strokeWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    alertBadgeWarning: {
      backgroundColor: theme.colors.emergencyFill,
      borderColor: theme.colors.emergencyStroke,
    },
    alertBadgeInfo: {
      backgroundColor: theme.colors.midnightBlue,
      borderColor: theme.colors.avatarStroke,
    },

    feedback: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: FEEDBACK_INSET,
    },
    feedbackPhoto: {
      width: FEEDBACK_PHOTO.width,
      height: FEEDBACK_PHOTO.height,
      borderRadius: theme.borderRadius.sm / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      overflow: 'hidden',
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    photoImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    feedbackIcon: {
      position: 'absolute',
      top: FEEDBACK_ICON_INSET,
      left: FEEDBACK_ICON_INSET,
    },
    feedbackText: {
      flex: 1,
      marginLeft: FEEDBACK_PHOTO_TO_TEXT,
      marginRight: FEEDBACK_TEXT_TO_BUTTON,
    },
    feedbackBody: {
      marginTop: FEEDBACK_BODY_TOP,
    },
    feedbackButton: {
      width: FEEDBACK_BUTTON_WIDTH,
      height: FEEDBACK_BUTTON_HEIGHT,
    },
    feedbackButtonSurface: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
    },
  });
}
