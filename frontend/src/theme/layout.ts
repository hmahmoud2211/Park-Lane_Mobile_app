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

  /**
   * Device controls (DeviceDetail, DeviceCard): every touch target at least 48dp, the
   * main control bigger still, so a child or an older resident hits what they mean.
   * Heights are minimums: buttons grow with large text instead of clipping it.
   */
  deviceControl: {
    minTarget: 48,
    button: 56,
    /** A light's big On/Off. */
    heroButton: 104,
    /** Buttons with the icon above the words: Open / Stop / Close, Start / Pause, − / +. */
    remoteKey: 72,
    /** The round − / + around a target temperature. */
    stepButton: 64,
    swatch: 36,
    /** A long list of choices (a TV's inputs) scrolls inside this height. */
    listMaxHeight: 312,
    /** Chip rows hold three across before wrapping; four choices sit two by two. */
    chipBasis: '30%',
    chipBasisPair: '45%',
  },

  /**
   * The TV remote (features/home/components/TvRemote): a tall rounded body like the remote in
   * the hand, round keys, a circular D-pad and two rockers. Every key is at least 56dp.
   */
  tvRemote: {
    bodyMaxWidth: 360,
    roundKey: 56,
    /** The ring's diameter and the OK key at its centre. */
    dpad: 232,
    dpadOk: 96,
    /** Each arrow is a segment of the ring: long side along the ring, short side across it. */
    dpadArrowLong: 96,
    dpadArrowShort: 64,
    /** VOL and CH: pills with + on top and − below, each half a full key. */
    rockerWidth: 68,
    rockerHalf: 64,
    keyIcon: 24,
    okIcon: 28,
  },

  /**
   * Reporting an AI answer (features/aiReports): the small "Report" text button under an answer still takes a
   * tap at least 44dp tall and wide, and the sheet it opens offers each reason as a big, easy target.
   */
  aiReport: {
    minTarget: 44,
    sheetMaxWidth: 440,
    reasonMinHeight: 52,
  },
} as const;
