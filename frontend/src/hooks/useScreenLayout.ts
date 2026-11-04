import { useContext, useMemo } from 'react';
import { useWindowDimensions, type ViewStyle } from 'react-native';

import { ShellContext } from '../context/ShellContext';
import type { Breakpoint } from '../theme';
import { resolveScreenLayout, type ScreenLayout } from '../utils/responsive';
import { useAppTheme } from './useAppTheme';

export interface ScreenLayoutWithStyles extends ScreenLayout {
  /**
   * Laid over a screen's scroll content style on wide layouts: the wider
   * cap, the device class's gutter, and bottom padding without the bottom
   * bar's clearance. Undefined on phones, so their measured styles stand.
   */
  contentStyle: ViewStyle | undefined;
}

/**
 * The page geometry for the frame the screen is drawn in. Screens use it
 * instead of `useWindowDimensions`, which on a tablet or desktop also counts
 * the side rail.
 */
export function useScreenLayout(): ScreenLayoutWithStyles {
  const theme = useAppTheme();
  const shell = useContext(ShellContext);
  const window = useWindowDimensions();
  const windowWidth = shell?.windowWidth ?? window.width;
  const frameWidth = shell?.frameWidth ?? window.width;

  return useMemo(() => {
    const resolved = resolveScreenLayout(windowWidth, frameWidth);
    return {
      ...resolved,
      contentStyle: resolved.isWide
        ? {
            width: '100%',
            maxWidth: resolved.contentMaxWidth + 2 * resolved.gutter,
            alignSelf: 'center',
            paddingHorizontal: resolved.gutter,
            paddingBottom: theme.layout.endGap,
          }
        : undefined,
    };
  }, [windowWidth, frameWidth, theme]);
}

/**
 * Picks a value for the current device class. Classes left out inherit from
 * the next smaller one, so `{ mobile: 2, laptop: 4 }` is 2 on tablets.
 */
export function useResponsiveValue<T>(values: { mobile: T } & Partial<Record<Breakpoint, T>>): T {
  const { breakpoint } = useScreenLayout();
  return pickResponsive(values, breakpoint);
}

const ORDER: readonly Breakpoint[] = ['mobile', 'tablet', 'laptop', 'desktop'];

export function pickResponsive<T>(values: { mobile: T } & Partial<Record<Breakpoint, T>>, breakpoint: Breakpoint): T {
  for (let i = ORDER.indexOf(breakpoint); i >= 0; i -= 1) {
    const value = values[ORDER[i]];
    if (value !== undefined) {
      return value;
    }
  }
  return values.mobile;
}
