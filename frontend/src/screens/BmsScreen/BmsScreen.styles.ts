import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import { imageAspects } from '../../constants/images';
import { layout } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH, clamp } from '../../utils/responsive';
import type { ReadingTone } from './BmsScreen.data';

/**
 * Measured from the Figma screens (assets/Screens/screen15.png, continued in
 * screen16.png and screen17.png), each a 390dp frame exported about 790px wide
 * (2.02px per dp) inside a glow. The reference draws 330-338dp panels; here they
 * span My Unit's width (a 16dp gutter, 358dp at 390dp), as on the other inner
 * screens, and the rhythm between and inside them is theirs: roomier than the
 * reference. Sizes and colours follow the reference; the type is My Unit's.
 */
const GUTTER = layout.innerScreen.gutter;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = layout.innerScreen.headerGutter;
export const CARD_GAP = layout.innerScreen.cardGap;
const HEADER_TO_BANNER = layout.innerScreen.headerToContent;
const PANEL_INSET = layout.innerScreen.panelInset;

/** Inside width of a panel on the 390dp frame, which the rows were fitted to. */
const FITTED_PANEL_WIDTH = 330;

/**
 * Where panels are narrower than the 390dp frame's, the small type and the
 * fixed-width tiles shrink in step, so labels keep their one-line layout.
 * Wider panels keep the reference size.
 */
export function contentScaleFor(columnFrameWidth: number): number {
  const panel = Math.min(columnFrameWidth, MAX_CONTENT_WIDTH) - 2 * GUTTER - 2 * PANEL_INSET;
  return clamp(panel / FITTED_PANEL_WIDTH, 0.85, 1);
}

/** The photo banner, drawn 126dp tall on a 330dp panel: the photo's own aspect at 358dp. */
export const BANNER_HEIGHT = 136;
export const BANNER_DOT_SIZE = 9;

/** Nested tiles: glass on glass, drawn with an 8dp corner. */
export const TILE_RADIUS = 8;
export const HEADING_ICON_SIZE = 19;
const HEADING_TO_BODY = 6;

/** Overview: the health ring, drawn 40dp, and two figures, split by hairlines. */
export const RING_SIZE = 46;
export const RING_STROKE = 4.5;
const SUMMARY_VERTICAL = 20;
export const SUMMARY_ICON_SIZE = 20;

/** Ventilation: two tiles either side of the fan, which is centred on the panel. */
const FAN_HEIGHT = 108;
const FAN_TILE_WIDTH = 96;
const FAN_TILE_HEIGHT = 38;
const FAN_TILE_GAP = 12;

/** Electrical: the board-and-generator strip over two figure tiles. */
const STRIP_HEIGHT = 56;
const STRIP_INSET = 12;
export const STRIP_ICON_SIZE = 15;
export const TREND_ICON_SIZE = 13;
const FEED_HEIGHT = 58;
const FEED_GAP = 12;
export const FEED_ICON_SIZE = 15;
export const LEVEL_HEIGHT = 7;

/** Internet: the gauge, drawn 96dp across, over its reading; three rows beside it. */
export const GAUGE_WIDTH = 108;
const SPEED_PILL_HEIGHT = 20;
const NETWORK_ROW_HEIGHT = 28;
const NETWORK_ROW_GAP = 8;
export const NETWORK_ICON_SIZE = 13;
export const DOWNLOAD_ICON_SIZE = 14;

/** Security: the gates and the camera, side by side at equal widths. */
const SECURITY_GAP = 12;
export const GATE_ICON_SIZE = 16;
export const CAMERA_ICON_SIZE = 13;
export const CAMERA_ARROW_SIZE = 11;
const CAMERA_HEADER_HEIGHT = 24;

/** Elevator: the cabin, drawn 78dp wide, beside its detail table. */
const ELEVATOR_WIDTH = 86;
const ELEVATOR_ROW_HEIGHT = 26;

/** Water: the tank level row over three pump tiles. */
const TANK_ROW_HEIGHT = 32;
/** Drawn 85dp wide with 31dp between; they share the row, so they widen with the panel. */
const PUMP_GAP = 24;
const PUMP_TILE_HEIGHT = 84;
export const PUMP_ICON_SIZE = 22;
export const WAVE_HEIGHT = 12;

/** Fire & Life Safety: three rows. */
const SAFETY_ROW_HEIGHT = 32;
const SAFETY_ROW_GAP = 8;
export const SAFETY_ICON_SIZE = 14;

/** The colour a reading is set in. */
export function toneColor(theme: AppTheme, tone: ReadingTone): string {
  switch (tone) {
    case 'ok':
      return theme.colors.bmsStatus;
    case 'good':
      return theme.colors.bmsExcellent;
    case 'plain':
      return theme.colors.textPrimary;
  }
}

export function createStyles(theme: AppTheme, scale: number) {
  return StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      // Shared by every screen, so the brand lockup sits at the same height.
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
      // Clears the pinned bottom bar so the last card scrolls fully into view.
      paddingBottom: NAV_BAR_CLEARANCE + 2 * CARD_GAP,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },
    // Not in the design: says the readings are simulated (a demo compound) or the design's sample.
    dataChip: {
      alignSelf: 'flex-start',
      marginTop: -HEADER_TO_BANNER / 2,
      marginBottom: HEADER_TO_BANNER / 2,
    },
    banner: {
      marginBottom: CARD_GAP,
    },
    pressed: {
      opacity: 0.6,
    },
    disabled: {
      opacity: 0.35,
    },

    /* Shared panel pieces */
    panel: {
      paddingBottom: PANEL_INSET,
    },
    body: {
      marginTop: HEADING_TO_BODY,
      paddingHorizontal: PANEL_INSET,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    grow: {
      flex: 1,
      minWidth: 0,
    },
    centred: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconGap: {
      marginRight: theme.spacing.sm,
    },
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
    },

    /* Banner footer */
    bannerStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
    },
    bannerDot: {
      width: BANNER_DOT_SIZE,
      height: BANNER_DOT_SIZE,
      borderRadius: BANNER_DOT_SIZE / 2,
      marginRight: theme.spacing.sm,
      backgroundColor: theme.colors.bmsStatusBright,
      shadowColor: theme.colors.bmsStatusBright,
      shadowOpacity: 0.8,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
    },

    /* Overview */
    summary: {
      paddingVertical: SUMMARY_VERTICAL,
      paddingHorizontal: theme.spacing.xs,
    },
    summaryColumn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryLabel: {
      marginTop: theme.spacing.sm,
    },
    summaryValue: {
      marginTop: 5,
    },

    /* Ventilation */
    fanBody: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: HEADING_TO_BODY,
      paddingHorizontal: PANEL_INSET,
    },
    fanColumn: {
      gap: FAN_TILE_GAP,
    },
    fanTile: {
      width: FAN_TILE_WIDTH * scale,
      height: FAN_TILE_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xs,
    },
    // Centred on the whole panel, as drawn, so it rises beside the heading.
    fanLayer: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Sized on both sides: react-native-web otherwise lays an image out at its file's size.
    fan: {
      width: FAN_HEIGHT * scale * imageAspects.bmsFan,
      height: FAN_HEIGHT * scale,
    },

    /* Electrical */
    strip: {
      height: STRIP_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: STRIP_INSET,
    },
    stripHalf: {
      flex: 1,
      minWidth: 0,
      height: '100%',
      justifyContent: 'center',
      gap: 7,
    },
    stripDivider: {
      width: StyleSheet.hairlineWidth,
      height: STRIP_HEIGHT - 2 * STRIP_INSET,
      marginHorizontal: STRIP_INSET,
      backgroundColor: theme.colors.border,
    },
    stripLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    stripFigures: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.lg,
    },
    figure: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    dotStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    level: {
      flex: 1,
      marginHorizontal: theme.spacing.sm,
    },
    feeds: {
      flexDirection: 'row',
      gap: FEED_GAP,
      marginTop: PANEL_INSET,
    },
    feed: {
      flex: 1,
      height: FEED_HEIGHT,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    feedFigures: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    feedFigure: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs + 2,
    },
    feedDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: theme.colors.border,
    },

    /* Internet */
    internetBody: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: HEADING_TO_BODY,
      paddingHorizontal: PANEL_INSET,
      gap: theme.spacing.md,
    },
    speed: {
      flex: 1,
      alignItems: 'center',
    },
    speedPill: {
      height: SPEED_PILL_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      marginTop: theme.spacing.xs,
    },
    download: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: theme.spacing.sm,
    },
    networkRows: {
      flex: 1.25,
      gap: NETWORK_ROW_GAP,
    },
    networkRow: {
      height: NETWORK_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
    },

    /* Security */
    securityBody: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: SECURITY_GAP,
      marginTop: HEADING_TO_BODY,
      paddingHorizontal: PANEL_INSET,
    },
    gateList: {
      flex: 1,
      justifyContent: 'space-around',
      paddingHorizontal: 10,
      paddingVertical: theme.spacing.xs,
    },
    gateRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    gateDivider: {
      marginHorizontal: theme.spacing.lg,
    },
    camera: {
      flex: 1,
      overflow: 'hidden',
    },
    cameraHeader: {
      height: CAMERA_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    cameraArrows: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    cameraArrow: {
      padding: 2,
    },
    snapshot: {
      width: '100%',
      aspectRatio: imageAspects.bmsCctvEntrance,
      borderBottomLeftRadius: TILE_RADIUS,
      borderBottomRightRadius: TILE_RADIUS,
      overflow: 'hidden',
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    snapshotImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },

    /* Elevator */
    elevatorBody: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: HEADING_TO_BODY,
      paddingHorizontal: PANEL_INSET,
      gap: theme.spacing.md,
    },
    elevatorImage: {
      width: ELEVATOR_WIDTH * scale,
      height: (ELEVATOR_WIDTH * scale) / imageAspects.bmsElevator,
    },
    detailTable: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.xs,
    },
    detailRow: {
      height: ELEVATOR_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    chip: {
      minWidth: 52,
    },

    /* Water */
    tankRow: {
      height: TANK_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    tankBar: {
      flex: 1,
      marginHorizontal: theme.spacing.md,
    },
    pumps: {
      flexDirection: 'row',
      gap: PUMP_GAP * scale,
      marginTop: PANEL_INSET,
    },
    pumpTile: {
      flex: 1,
      height: PUMP_TILE_HEIGHT,
      alignItems: 'center',
      paddingTop: 10,
      overflow: 'hidden',
    },
    pumpName: {
      marginTop: 5,
    },
    pumpStatus: {
      marginTop: 2,
    },
    wave: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 3,
    },

    /* Fire & Life Safety */
    safetyRows: {
      gap: SAFETY_ROW_GAP,
    },
    safetyRow: {
      height: SAFETY_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    safetyName: {
      flex: 1.1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
    },
    safetyStatus: {
      flex: 0.7,
    },
  });
}
