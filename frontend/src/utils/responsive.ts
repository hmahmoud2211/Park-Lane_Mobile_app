import { breakpointFor, layout, type Breakpoint } from '../theme';
import type { AppTheme } from '../types/theme.types';

/**
 * The design was measured against a 390 x 844 frame (iPhone 14 / 15 logical
 * size). Helpers below scale those measurements to the running device.
 */
export const BASE_WIDTH = 390;

/** Small-phone breakpoint, below which type and spacing tighten up. */
export const COMPACT_HEIGHT = 700;

/** Above this width the phone layout stops growing and centres instead. */
export const MAX_CONTENT_WIDTH = layout.phoneMaxWidth;

function scaleWidth(size: number, windowWidth: number): number {
  return (windowWidth / BASE_WIDTH) * size;
}

/**
 * Scales a design measurement but damps the change, so type and spacing grow
 * gently rather than tracking screen width one-for-one.
 */
export function scaleModerately(size: number, windowWidth: number, factor = 0.5): number {
  return size + (scaleWidth(size, windowWidth) - size) * factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where a page's content sits, worked out from the frame it is drawn in. */
export interface ScreenLayout {
  /** The device class, from the window width. */
  breakpoint: Breakpoint;
  /**
   * Tablet and up: the side rail replaces the bottom bar and pages reflow.
   * False on phones, where every screen keeps its measured layout.
   */
  isWide: boolean;
  /** Width of the area the page is drawn in, after the side rail. */
  frameWidth: number;
  /** Page gutter on wide layouts. */
  gutter: number;
  /** Width inside the gutters, after the cap for the device class. */
  contentWidth: number;
  contentMaxWidth: number;
  /** 2 where the page has room for two columns of phone-width cards. */
  columns: 1 | 2;
  columnGap: number;
  /** Width of one page column. */
  columnWidth: number;
  /**
   * The phone-frame width one column corresponds to: the column plus the
   * phones' 16dp gutters. Pass it to the screens' scale helpers, which were
   * written against the window width of a phone.
   */
  columnFrameWidth: number;
}

const PHONE_GUTTER = 16;

export function resolveScreenLayout(windowWidth: number, frameWidth: number): ScreenLayout {
  const breakpoint = breakpointFor(windowWidth);

  if (breakpoint === 'mobile') {
    return {
      breakpoint,
      isWide: false,
      frameWidth,
      gutter: PHONE_GUTTER,
      contentWidth: Math.min(frameWidth, MAX_CONTENT_WIDTH) - 2 * PHONE_GUTTER,
      contentMaxWidth: MAX_CONTENT_WIDTH,
      columns: 1,
      columnGap: 0,
      columnWidth: Math.min(frameWidth, MAX_CONTENT_WIDTH) - 2 * PHONE_GUTTER,
      columnFrameWidth: frameWidth,
    };
  }

  const gutter = layout.gutter[breakpoint];
  const contentMaxWidth = layout.contentMaxWidth[breakpoint];
  const columnGap = layout.columnGap[breakpoint];
  const contentWidth = Math.max(0, Math.min(frameWidth - 2 * gutter, contentMaxWidth));
  const columns = contentWidth >= 2 * layout.minColumnWidth + columnGap ? 2 : 1;
  const columnWidth = columns === 2 ? (contentWidth - columnGap) / 2 : contentWidth;

  return {
    breakpoint,
    isWide: true,
    frameWidth,
    gutter,
    contentWidth,
    contentMaxWidth,
    columns,
    columnGap,
    columnWidth,
    columnFrameWidth: columnWidth + 2 * PHONE_GUTTER,
  };
}

/** The inner screens' 16dp gutter (My Unit's), which the figure rows were fitted with. */
const STAT_CARD_GUTTER = 16;

/**
 * Inside width of a card when the figure rows were fitted to the reference:
 * a 390dp frame, 10dp gutter and 16dp card padding.
 */
const FITTED_CARD_INNER_WIDTH = 338;

/**
 * Where a card is narrower inside than the rows were fitted to, the rows
 * shrink in step, so every value keeps its one-line layout rather than
 * truncating. Wider cards keep the reference size.
 */
export function statScaleFor(windowWidth: number, theme: AppTheme): number {
  const inner = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 2 * (STAT_CARD_GUTTER + theme.spacing.md);
  return clamp(inner / FITTED_CARD_INNER_WIDTH, 0.8, 1);
}
