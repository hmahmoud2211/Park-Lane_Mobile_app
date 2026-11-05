import { createContext } from 'react';

export interface ShellContextValue {
  windowWidth: number;
  /** Width of the area screens are drawn in: the window less the side rail. */
  frameWidth: number;
  /** Wide enough for the side rail, so bottom bars stand down. */
  sideNavAvailable: boolean;
  /** The rail is on screen, because the focused screen asked for it. */
  sideNavVisible: boolean;
  /**
   * Room the rail takes at the left. Screen backgrounds run under the rail;
   * ScreenWrapper insets the content by this much.
   */
  railReserve: number;
  /** The rail is expanded and carries the wordmark, so page headers leave theirs out. */
  brandInRail: boolean;
  /**
   * Called by a focused screen that has app navigation (its bottom bar, or the
   * Assistant). Returns the release to call when the screen loses focus.
   */
  requestSideNav: () => () => void;
}

/**
 * Null outside AppShell; the hooks then fall back to the bare window, which
 * is what a screen rendered on its own (a test, a story) should see.
 */
export const ShellContext = createContext<ShellContextValue | null>(null);
