import type { Breakpoint } from './breakpoints';

/** Where the phone layout stops growing and centres instead. */
const PHONE_MAX_WIDTH = 520;

/**
 * Page geometry per device class. On mobile the screens keep their own
 * measured gutters and the 520dp cap (they were drawn for a 390dp frame);
 * from tablet up the bottom bar becomes a side rail and pages reflow into a
 * wider column, or two, using the values below.
 */
export const layout = {
  /** The phone layout stops growing here and centres instead. */
  phoneMaxWidth: PHONE_MAX_WIDTH,

  sideNav: {
    /** Icon-over-label rail, for tablets and small windows. */
    compactWidth: 96,
    /** Icon-beside-label rail with the wordmark, once the window is this wide. */
    expandedWidth: 240,
    expandedFrom: 1280,
    /** The rail floats this far in from the window edges. */
    inset: 12,
  },

  /** Widest the page content gets, per device class. */
  contentMaxWidth: {
    mobile: PHONE_MAX_WIDTH,
    tablet: 680,
    laptop: 1040,
    desktop: 1180,
  } satisfies Record<Breakpoint, number>,

  /** Page gutter from tablet up; mobile keeps each screen's own. */
  gutter: {
    mobile: 16,
    tablet: 24,
    laptop: 32,
    desktop: 40,
  } satisfies Record<Breakpoint, number>,

  /** Space between side-by-side page columns. */
  columnGap: {
    mobile: 0,
    tablet: 20,
    laptop: 24,
    desktop: 28,
  } satisfies Record<Breakpoint, number>,

  /**
   * A page splits into two columns only when each would be at least this
   * wide, so cards fitted to a 358dp phone frame never get squeezed.
   */
  minColumnWidth: 380,

  /** Space under the last card when no bottom bar needs clearing. */
  endGap: 32,

  /**
   * The inner screens' phone rhythm, set by My Unit and shared by the screens built after
   * it: a 16dp gutter (358dp cards at 390dp), the page header still drawn for the Figma's
   * 35dp gutter, 30dp from the header to the first card, 18dp between cards and panels
   * inset 14dp. Roomier than the Figma exports, which pack cards edge to edge.
   */
  innerScreen: {
    gutter: 16,
    headerGutter: 35,
    headerToContent: 30,
    cardGap: 18,
    panelInset: 14,
    buttonHeight: 46,
  },
} as const;
