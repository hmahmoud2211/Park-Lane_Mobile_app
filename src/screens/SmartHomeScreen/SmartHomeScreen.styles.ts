import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/**
 * Measured from the Figma screen (assets/Screens/screen9.png, continued in
 * screen10.png), exported at 794px for a 390dp frame (2.036px per dp). Its
 * header and bottom bar sit where Community's do, so the rhythm is the inner
 * screens' shared one: the spacing between and inside the cards is roomier
 * than the reference, which packs them almost edge to edge. The cards span
 * My Unit's width (a 16dp gutter, 358dp at 390dp), as asked for. Sizes and
 * colours follow the reference; the type is My Unit's, shared by the inner
 * screens.
 */
const GUTTER = 16;
/** The gutter PageHeader is drawn for; the header keeps its place on screen. */
const HEADER_GUTTER = 35;
const CARD_GAP = 18;

/** As on Maintenance, Parking and Community; Home's header sits at 28. */
const HEADER_TOP = 44;
const HEADER_TO_BANNER = 30;

/**
 * The unit banner, drawn 93dp tall. Taller here for the larger title and so
 * the chevron clears the bottom edge by about as much as the title sits below
 * the top (FeatureBanner's 22dp): 108dp of content plus 20dp beneath.
 */
export const BANNER_HEIGHT = 128;
/** The banner's round chevron, drawn 22dp. */
export const BANNER_BUTTON_SIZE = 26;
const BANNER_BUTTON_TOP = 12;
export const BANNER_CHEVRON_SIZE = 13;

/** Room chips (FilterChip), scrolling sideways within the cards' width. */
const BANNER_TO_ROOMS = 14;
const ROOMS_TO_GRID = 18;
const ROOM_GAP = 7;
export const ROOM_ICON_SIZE = 15;
/** Room for the active chip's glow inside the scroll view, which clips. */
const ROOM_GLOW_ROOM = 4;

/** The two-by-two control cards, drawn 7dp apart. */
export const GRID_GAP = 12;
const CONTROL_ROW_TOP = 8;

/** Curtains: three round buttons, drawn 39dp. */
export const CURTAIN_BUTTON_SIZE = 42;
export const CURTAIN_ICON_SIZE = 15;
/** TV & Media: four app tiles, drawn 29dp. */
export const MEDIA_TILE_SIZE = 29;
export const MEDIA_LOGO_HEIGHT = 15;
export const MEDIA_ICON_SIZE = 15;

export const HEADING_ICON_SIZE = 19;
const PANEL_INSET = 10;
const PANEL_BOTTOM = 12;
const ROW_GAP = 7;

/** The energy gauge, drawn 100dp across, beside its breakdown rows. */
export const GAUGE_SIZE = 104;
const GAUGE_TO_ROWS = 14;
const DEVICE_GAP = ROW_GAP + 1;

/**
 * Narrowest columns each section was fitted to. The control cards need the
 * 154dp they get on the 390dp frame, or "TV & Media" wraps into its supporting
 * line; below these, a section stacks into one column rather than overflow.
 */
const MIN_CONTROL_COLUMN = 154;
const MIN_DEVICE_COLUMN = 130;
const MIN_ENERGY_ROWS = 140;

export interface SmartHomeLayout {
  controlColumns: 1 | 2;
  deviceColumns: 1 | 2;
  /** Gauge above the breakdown rows rather than beside them. */
  energyStacked: boolean;
}

export function layoutFor(windowWidth: number): SmartHomeLayout {
  const content = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * GUTTER;
  const panel = content - 2 * PANEL_INSET;
  return {
    controlColumns: (content - GRID_GAP) / 2 >= MIN_CONTROL_COLUMN ? 2 : 1,
    deviceColumns: (panel - DEVICE_GAP) / 2 >= MIN_DEVICE_COLUMN ? 2 : 1,
    energyStacked: panel - 4 - GAUGE_SIZE - GAUGE_TO_ROWS < MIN_ENERGY_ROWS,
  };
}
/** Breakdown rows, drawn 20dp tall and 3.5dp apart. */
const ENERGY_ROW_HEIGHT = 25;
const ENERGY_ROW_GAP = 5;
const ENERGY_ROW_INSET = 9;

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
    pressed: {
      opacity: 0.7,
    },
    flipped: {
      transform: [{ scaleY: -1 }],
    },

    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_BANNER,
    },
    card: {
      marginBottom: CARD_GAP,
    },

    bannerButton: {
      width: BANNER_BUTTON_SIZE,
      height: BANNER_BUTTON_SIZE,
      marginTop: BANNER_BUTTON_TOP,
    },
    bannerButtonSurface: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Clipped at the cards' edges, so the row ends where they do. It reaches
    // out by the glow's width only, so the active chip's halo is not cut off.
    rooms: {
      marginHorizontal: -ROOM_GLOW_ROOM,
      marginTop: BANNER_TO_ROOMS - ROOM_GLOW_ROOM,
      marginBottom: ROOMS_TO_GRID - ROOM_GLOW_ROOM,
    },
    roomsContent: {
      padding: ROOM_GLOW_ROOM,
      gap: ROOM_GAP,
    },

    grid: {
      flexDirection: 'row',
      gap: GRID_GAP,
      marginBottom: GRID_GAP,
    },
    gridLast: {
      marginBottom: CARD_GAP,
    },
    gridStacked: {
      flexDirection: 'column',
    },
    gridCell: {
      flex: 1,
    },

    curtainRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: CONTROL_ROW_TOP,
    },
    curtainButton: {
      width: CURTAIN_BUTTON_SIZE,
      height: CURTAIN_BUTTON_SIZE,
    },
    curtainSurface: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },

    mediaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: CONTROL_ROW_TOP,
    },
    // Equal columns, so the labels cannot crowd one another.
    mediaItem: {
      flex: 1,
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    mediaTile: {
      width: MEDIA_TILE_SIZE,
      height: MEDIA_TILE_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaLogo: {
      height: MEDIA_LOGO_HEIGHT,
    },

    sceneRow: {
      flexDirection: 'row',
      gap: ROW_GAP,
      paddingHorizontal: PANEL_INSET,
      paddingTop: 2,
      paddingBottom: PANEL_BOTTOM,
    },

    energyBody: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: PANEL_INSET + 2,
      paddingBottom: PANEL_BOTTOM,
    },
    energyStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    energyGaugeStacked: {
      alignSelf: 'center',
    },
    energyRows: {
      flex: 1,
      marginLeft: GAUGE_TO_ROWS,
      gap: ENERGY_ROW_GAP,
    },
    energyRowsStacked: {
      flex: 0,
      marginLeft: 0,
      marginTop: GAUGE_TO_ROWS,
    },
    energyRow: {
      height: ENERGY_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: ENERGY_ROW_INSET,
    },
    energyLabel: {
      flex: 1,
      marginLeft: ENERGY_ROW_INSET,
    },

    deviceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: DEVICE_GAP,
      paddingHorizontal: PANEL_INSET,
      paddingTop: 2,
      paddingBottom: PANEL_BOTTOM,
    },
    // Two across: three bases would overflow the row, and each grows into its half.
    deviceCell: {
      flexGrow: 1,
      flexBasis: '40%',
    },
    deviceCellFull: {
      flexBasis: '100%',
    },

    automationList: {
      gap: ROW_GAP,
      paddingHorizontal: PANEL_INSET,
      paddingTop: 2,
      paddingBottom: PANEL_BOTTOM,
    },
  });
}
