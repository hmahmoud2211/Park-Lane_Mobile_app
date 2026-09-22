/**
 * The design was measured against a 390 x 844 frame (iPhone 14 / 15 logical
 * size). Helpers below scale those measurements to the running device.
 */
export const BASE_WIDTH = 390;
export const BASE_HEIGHT = 844;

/** Small-phone breakpoint, below which type and spacing tighten up. */
export const COMPACT_HEIGHT = 700;

/** Above this width the layout stops growing and centres instead. */
export const MAX_CONTENT_WIDTH = 520;

export function scaleWidth(size: number, windowWidth: number): number {
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
