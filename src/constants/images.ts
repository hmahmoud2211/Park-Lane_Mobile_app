/**
 * Every bundled image is referenced here, so swapping an asset is a one-line
 * change. Design sources (screenshots, palette sheets) stay in the repo-root
 * assets/ folder and are deliberately not bundled.
 */
export const images = {
  mainBackground: require('../assets/images/backgrounds/main-background.png') as number,
} as const;

export type ImageKey = keyof typeof images;
