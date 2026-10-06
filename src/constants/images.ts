/**
 * Every bundled image is referenced here, so swapping an asset is a one-line
 * change. Design sources (screenshots, palette sheets) stay in the repo-root
 * assets/ folder and are deliberately not bundled.
 */
export const images = {
  mainBackground: require('../assets/images/backgrounds/main-background.jpg') as number,
  loginBackground: require('../assets/images/backgrounds/login-background.jpg') as number,

  /**
   * PLACEHOLDER. Generated stand-in for the brand lockup so the login screen
   * renders complete. Replace with the official transparent export at the same
   * path; nothing else needs to change.
   */
  brandWordmark: require('../assets/images/logos/brand-wordmark.png') as number,

  /**
   * PLACEHOLDER, cut from the My Unit reference (assets/Screens/screen4.png):
   * the leaf mark over "PARKLANE / SMART COMMUNITY LIVING", white on
   * transparent at roughly 2x. Replace with the official export at this path;
   * nothing else needs to change.
   */
  brandLockup: require('../assets/images/logos/brand-lockup.png') as number,

  /** Google's official four-colour mark, rasterised from their brand paths. */
  googleMark: require('../assets/images/icons/google-mark.png') as number,

  homeBackground: require('../assets/images/backgrounds/home-background.jpg') as number,

  unitPhoto: require('../assets/images/illustrations/unit-a302.jpg') as number,

  /**
   * PLACEHOLDER, cropped from the home screen reference. Replace with the real
   * export at this path; no code change needed.
   */
  promoPhoto: require('../assets/images/illustrations/promo-lifestyle.png') as number,

  /**
   * PLACEHOLDER, cropped from the Visitor Access reference
   * (assets/Screens/screen5.png) at about 2x: the entrance at night with the
   * PARKLANE sign. Replace with the full-resolution export at this path; no
   * code change needed.
   */
  visitorHero: require('../assets/images/illustrations/visitor-hero.jpg') as number,

  /**
   * PLACEHOLDER, cropped from the Maintenance reference
   * (assets/Screens/screen6.png) at about 2x: the lobby entrance with the
   * PARKLANE sign. Replace with the full-resolution export at this path; no
   * code change needed.
   */
  maintenanceHero: require('../assets/images/illustrations/maintenance-hero.jpg') as number,

  /**
   * PLACEHOLDERS, cropped from the Parking reference (assets/Screens/screen7.png)
   * at about 1.6x, so they are soft on high-density screens: the entrance with
   * the PARKLANE sign, and the resident's bay at P2-148. Replace with the
   * full-resolution exports at these paths; no code change needed.
   */
  parkingHero: require('../assets/images/illustrations/parking-hero.jpg') as number,
  parkingSlot: require('../assets/images/illustrations/parking-slot.jpg') as number,

  /**
   * PLACEHOLDER, keyed out of the Parking reference: the BMW X5 on a
   * transparent background. Replace with a transparent render at this path.
   */
  registeredVehicle: require('../assets/images/illustrations/registered-vehicle.png') as number,

  /**
   * PLACEHOLDERS, cropped from the Community reference (assets/Screens/screen8.png)
   * at about 2x, so the banner photo in particular is soft once enlarged.
   * The gate, pool-at-night and feedback crops still carry the badge the
   * reference draws over them; the screen draws its own on top, so clean
   * replacements need no code change. Replace each at its path.
   */
  communityHero: require('../assets/images/illustrations/community-hero.jpg') as number,
  communityPool: require('../assets/images/illustrations/community-pool.jpg') as number,
  communityCafe: require('../assets/images/illustrations/community-cafe.jpg') as number,
  communityMovie: require('../assets/images/illustrations/community-movie.jpg') as number,
  communityYoga: require('../assets/images/illustrations/community-yoga.jpg') as number,
  communityGathering: require('../assets/images/illustrations/community-gathering.jpg') as number,
  communityGate: require('../assets/images/illustrations/community-gate.jpg') as number,
  communityPoolNight: require('../assets/images/illustrations/community-pool-night.jpg') as number,
  communityPollEvents: require('../assets/images/illustrations/community-poll-events.jpg') as number,
  communityPollFitness: require('../assets/images/illustrations/community-poll-fitness.jpg') as number,
  communityPollKids: require('../assets/images/illustrations/community-poll-kids.jpg') as number,
  communityFeedback: require('../assets/images/illustrations/community-feedback.jpg') as number,

  /**
   * PLACEHOLDERS, cropped from the Smart Home reference (assets/Screens/screen9.png)
   * at about 2x, so they are soft on high-density screens. The banner crop
   * starts right of the baked-in unit name. The scene photos had their
   * baked-in icon and label painted out, and the screen draws its own over the
   * faint traces left behind. Replace each at its path; no code change needed.
   */
  smartHomeHero: require('../assets/images/illustrations/smart-home-hero.jpg') as number,
  sceneWelcome: require('../assets/images/illustrations/smart-scene-welcome.jpg') as number,
  sceneRelax: require('../assets/images/illustrations/smart-scene-relax.jpg') as number,
  sceneMovie: require('../assets/images/illustrations/smart-scene-movie.jpg') as number,
  sceneNight: require('../assets/images/illustrations/smart-scene-night.jpg') as number,

  /**
   * PLACEHOLDERS, keyed out of the Smart Home reference at about 2x: the
   * streaming services' marks on transparent. Replace them with the official
   * brand assets at these paths.
   */
  netflixLogo: require('../assets/images/icons/netflix-logo.png') as number,
  youtubeLogo: require('../assets/images/icons/youtube-logo.png') as number,
  disneyLogo: require('../assets/images/icons/disney-logo.png') as number,
} as const;

/**
 * Width over height for banner photos, so they are laid out whole. Update an
 * entry if its replacement export is framed differently.
 */
export const imageAspects = {
  visitorHero: 411 / 195,
  maintenanceHero: 356 / 208,
  parkingHero: 312 / 149,
  parkingSlot: 306 / 136,
  registeredVehicle: 207 / 99,
  communityHero: 346 / 161,
  smartHomeHero: 363 / 182,
  netflixLogo: 36 / 42,
  youtubeLogo: 46 / 38,
  disneyLogo: 51 / 34,
} as const;

export type ImageKey = keyof typeof images;
