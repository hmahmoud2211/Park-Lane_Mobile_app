import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  BASE_WIDTH,
  COMPACT_HEIGHT,
  MAX_CONTENT_WIDTH,
  clamp,
  scaleModerately,
} from '../utils/responsive';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  return useMemo(
    () => ({
      width,
      height,
      /** True on short devices, where the design needs to tighten vertically. */
      isCompact: height < COMPACT_HEIGHT,
      /** Tablets and large phones, where content should stop stretching. */
      isWide: width > MAX_CONTENT_WIDTH,
      contentWidth: Math.min(width, MAX_CONTENT_WIDTH),
      /** Scale a design value, damped and clamped to a sane range. */
      scale: (size: number) => clamp(scaleModerately(size, width), size * 0.92, size * 1.12),
      widthRatio: width / BASE_WIDTH,
    }),
    [width, height],
  );
}
