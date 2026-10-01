import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH, clamp } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen6.png), exported at
 * 792px for a 390dp frame (2.031px per dp). Sizes and colours follow it; the
 * type is My Unit's. As on My Unit and Visitor Access, the spacing between and inside the
 * cards is deliberately roomier than the reference, which packs them almost
 * edge to edge, so the three inner screens share one rhythm.
 */
const GUTTER = 35;
const CARD_GAP = 18;

/** Panel width the tiles and visit details were fitted to: a 390dp frame. */
const FITTED_PANEL_WIDTH = 320;

/**
 * Where panels are narrower than the frame the tiles and details were fitted
 * to, they shrink in step, so every label keeps its one-line layout rather
 * than truncating. Wider panels keep the reference size.
 */
export function contentScaleFor(windowWidth: number): number {
  const panel = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * GUTTER;
  return clamp(panel / FITTED_PANEL_WIDTH, 0.85, 1);
}

/** Extra room above the header, as asked for; Home's header sits at 28. */
const HEADER_TOP = 44;
const HEADER_TO_BANNER = 30;

/** Service categories: three stacked tiles across, 12dp in from the panel edge. */
const PANEL_INSET = 14;
const TILE_GAP = 10;
/** The tiles keep the 12dp inset they were fitted to, so labels stay on one line. */
const GRID_INSET = 12;
/** Keeps the emergency line to one row at 390dp. */
const EMERGENCY_INSET = 14;

/** Active request: the request row, its stage track, then the visit details. */
const REQUEST_TOP = 16;
export const BADGE_SIZE = 32;
export const BADGE_ICON_SIZE = 22;
const BADGE_TO_TEXT = 12;
const CHIP_WIDTH = 74;
export const ROW_CHEVRON_SIZE = 13;
const STEPPER_TOP = 22;
/** The track's first and last nodes sit 42dp in from the panel edge, as drawn. */
const STEPPER_INSET = 2;
const DETAILS_DIVIDER_TOP = 18;
const DETAILS_INSET = 8;
const DETAILS_VERTICAL = 16;
export const DETAILS_GAP = 7;
/** Column widths for Technician, Visit Date and Contact, fitted to their longest lines. */
export const DETAILS_WEIGHTS = [86, 94, 94] as const;
/** The figures are the reference's small type, so StatItem is drawn at 80%. */
export const DETAILS_SCALE = 0.8;
export const DETAILS_ICON_SIZE = 23;
export const DETAILS_ICON_GAP = 8;

/** New Request and My Requests, side by side. */
export const ACTION_HEIGHT = 42;
export const ACTION_RADIUS = 10;
const ACTION_GAP = 12;
export const ACTION_ICON_SIZE = 20;
/** Matches AppButton's gap between an inline icon and its label. */
const ACTION_ICON_GAP = 12;

/** Emergency Support: one 60dp row with a warm wash at the left. */
const EMERGENCY_HEIGHT = 66;
export const EMERGENCY_ICON_SIZE = 24;
const CALL_HEIGHT = 28;
export const CALL_ICON_SIZE = 13;

/** A taller, narrower glass bar than Home's, as on Visitor Access. */
export const BOTTOM_BAR_HEIGHT = 72;
const BOTTOM_BAR_INSET = 40;
const BOTTOM_BAR_BOTTOM = 21;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: HEADER_TOP,
      paddingHorizontal: GUTTER,
      // Clears the pinned bottom bar so the last card scrolls fully into view.
      paddingBottom: BOTTOM_BAR_BOTTOM + BOTTOM_BAR_HEIGHT + 2 * CARD_GAP,
    },
    flex: {
      flex: 1,
    },
    pressed: {
      opacity: 0.7,
    },

    header: {
      marginBottom: HEADER_TO_BANNER,
    },
    card: {
      marginBottom: CARD_GAP,
    },

    categories: {
      paddingBottom: PANEL_INSET,
    },
    grid: {
      paddingHorizontal: GRID_INSET,
      gap: TILE_GAP,
    },
    gridRow: {
      flexDirection: 'row',
      gap: TILE_GAP,
    },
    tile: {
      flex: 1,
    },

    request: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: REQUEST_TOP,
      paddingHorizontal: PANEL_INSET,
    },
    badge: {
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    requestText: {
      flex: 1,
      marginLeft: BADGE_TO_TEXT,
      marginRight: theme.spacing.sm,
    },
    requestMeta: {
      marginTop: 3,
    },
    requestChip: {
      width: CHIP_WIDTH,
    },
    requestChevron: {
      marginLeft: 6,
    },
    stepper: {
      marginTop: STEPPER_TOP,
      paddingHorizontal: STEPPER_INSET,
    },
    detailsDivider: {
      height: StyleSheet.hairlineWidth,
      marginTop: DETAILS_DIVIDER_TOP,
      marginHorizontal: PANEL_INSET,
      backgroundColor: theme.colors.dividerSubtle,
    },
    details: {
      paddingHorizontal: DETAILS_INSET,
      paddingVertical: DETAILS_VERTICAL,
    },

    actions: {
      flexDirection: 'row',
      gap: ACTION_GAP,
    },
    newRequest: {
      flex: 1,
      // The pale rim and glow of the design's gradient buttons.
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      ...theme.shadows.glow,
    },
    myRequests: {
      flex: 1,
    },
    myRequestsPanel: {
      height: ACTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    myRequestsLabel: {
      marginLeft: ACTION_ICON_GAP,
    },

    emergency: {
      height: EMERGENCY_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: EMERGENCY_INSET,
      paddingRight: theme.spacing.sm,
    },
    // Clipped to the panel's corners; the glowing surface does not clip.
    emergencyWashClip: {
      ...StyleSheet.absoluteFill,
      // Follows the NeonPanel's corners.
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
    },
    emergencyWash: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: '45%',
    },
    emergencyIcon: {
      textShadowColor: theme.colors.emergencyStroke,
      textShadowRadius: 8,
      textShadowOffset: { width: 0, height: 0 },
    },
    emergencyText: {
      flex: 1,
      marginLeft: EMERGENCY_INSET,
      marginRight: theme.spacing.sm,
    },
    emergencyBody: {
      marginTop: 3,
    },
    callNow: {
      height: CALL_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: PANEL_INSET,
      borderRadius: CALL_HEIGHT / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.emergencyStroke,
      backgroundColor: theme.colors.emergencyFill,
      shadowColor: theme.colors.emergencyStroke,
      shadowOpacity: 0.6,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    callNowLabel: {
      marginLeft: 7,
    },
    emergencyChevron: {
      marginLeft: theme.spacing.sm,
    },

    bottomBar: {
      position: 'absolute',
      left: BOTTOM_BAR_INSET,
      right: BOTTOM_BAR_INSET,
      bottom: BOTTOM_BAR_BOTTOM,
    },
  });
}
