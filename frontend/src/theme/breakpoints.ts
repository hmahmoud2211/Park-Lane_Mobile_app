/**
 * Device classes, by window width. (Page geometry then works from the frame
 * left once the side rail has taken its share; see utils/responsive.)
 *
 *   mobile    320 - 767    phones in portrait
 *   tablet    768 - 1023   tablets in portrait, phones in landscape, small windows
 *   laptop   1024 - 1439   tablets in landscape, laptops
 *   desktop  1440 +        desktop monitors
 *
 * The phone layouts are the Figma measurements and stay exactly as drawn;
 * the wider classes reflow the same components (see theme/layout.ts).
 */
export const breakpoints = {
  tablet: 768,
  laptop: 1024,
  desktop: 1440,
} as const;

export type Breakpoint = 'mobile' | 'tablet' | 'laptop' | 'desktop';

export function breakpointFor(width: number): Breakpoint {
  if (width >= breakpoints.desktop) {
    return 'desktop';
  }
  if (width >= breakpoints.laptop) {
    return 'laptop';
  }
  if (width >= breakpoints.tablet) {
    return 'tablet';
  }
  return 'mobile';
}
