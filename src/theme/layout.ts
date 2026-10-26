import type { Breakpoint } from './breakpoints';

/**
 * Page geometry per device class. On mobile the screens keep their own
 * measured gutters and the 520dp cap (they were drawn for a 390dp frame);
 * from tablet up the bottom bar becomes a side rail and pages reflow into a
 * wider column, or two, using the values below.
 */
export const layout = {
  /** The phone layout stops growing here and centres instead. */
  phoneMaxWidth: 520,

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
    mobile: 520,
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
} as const;
