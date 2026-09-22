/**
 * Every bundled image is referenced here, so swapping an asset is a one-line
 * change. Design sources (screenshots, palette sheets) stay in the repo-root
 * assets/ folder and are deliberately not bundled.
 */
export const images = {
  mainBackground: require('../assets/images/backgrounds/main-background.png') as number,
  loginBackground: require('../assets/images/backgrounds/login-background.png') as number,

  /**
   * PLACEHOLDER. Generated stand-in for the brand lockup so the login screen
   * renders complete. Replace with the official transparent export at the same
   * path; nothing else needs to change.
   */
  brandWordmark: require('../assets/images/logos/brand-wordmark.png') as number,

  /** Google's official four-colour mark, rasterised from their brand paths. */
  googleMark: require('../assets/images/icons/google-mark.png') as number,
} as const;

export type ImageKey = keyof typeof images;
