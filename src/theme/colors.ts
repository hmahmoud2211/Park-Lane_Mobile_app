/**
 * Parklane color tokens.
 *
 * `palette` values are taken verbatim from the official palette sheet
 * (assets/Color Design/colors.png). Anything derived from the Figma
 * screenshots rather than that sheet is marked below.
 *
 * No file outside src/theme should contain a raw color literal.
 */
const palette = {
  electricCyan: '#19D7FF', // frame glow
  neonBlue: '#2B8CFF', // frame edge
  violet: '#7A4DFF', // secondary glow
  magenta: '#D44BFF', // accent glow
  deepNavy: '#071B44', // card fill
  midnightBlue: '#0A255E', // inner gradient

  white: '#FFFFFF',
  black: '#000000',
} as const;

export const colors = {
  ...palette,

  // Semantic roles
  primary: palette.neonBlue,
  secondary: palette.violet,
  accent: palette.electricCyan,

  background: palette.deepNavy,
  surface: palette.midnightBlue,

  textPrimary: palette.white,
  textSecondary: 'rgba(255, 255, 255, 0.70)',
  textMuted: 'rgba(255, 255, 255, 0.55)',

  border: 'rgba(255, 255, 255, 0.35)',

  /**
   * Glass frame spec, read from the Figma inspector capture
   * (assets/Color Design/color sign in frame.png).
   */
  frameGradientStart: '#4F7BFF',
  frameGradientEnd: '#FF5CCB',
  frameStroke: 'rgba(255, 255, 255, 0.45)',

  /**
   * Derived from the screen 1 screenshot, not the palette sheet.
   * The word "Living" reads as a light tint of `violet`, which is far
   * darker on screen than the headline actually appears.
   */
  headlineAccent: '#A98BFF',

  /** Legibility scrims over the background photo: `deepNavy` at alpha. */
  scrimTop: 'rgba(7, 27, 68, 0.45)',
  scrimBottom: 'rgba(7, 27, 68, 0.88)',

  /**
   * Form surfaces, taken from the login screen. The field fill is the same
   * glass treatment as the CTA, so only the muted text roles are new.
   */
  placeholder: 'rgba(255, 255, 255, 0.55)',
  /** Derived from the login screenshot: the soft blue supporting line. */
  textAccentSoft: '#A9C8FF',
  inputLabel: 'rgba(255, 255, 255, 0.75)',
  link: 'rgba(255, 255, 255, 0.50)',
  divider: 'rgba(255, 255, 255, 0.22)',
  /** Fill for small chips that sit on top of another surface. */
  surfaceSubtle: 'rgba(255, 255, 255, 0.12)',

  /**
   * Glowing card outlines on the home screen. Derived from that screenshot:
   * the tiles run cyan into blue, the feature cards blue into violet.
   */
  cardStrokeFrom: '#19D7FF',
  cardStrokeTo: '#2B8CFF',
  featureStrokeFrom: '#2B8CFF',
  featureStrokeTo: '#7A4DFF',

  /** Decorative corner glow (see components/ui/GlowArc). */
  glowInner: 'rgba(25, 215, 255, 0.55)',
  glowOuter: 'rgba(43, 140, 255, 0.00)',

  transparent: 'transparent',
} as const;

// NOTE: `success` / `warning` / `error` are intentionally absent. The supplied
// palette defines no status colors and none appear in screen 1; inventing them
// here would contradict the design system. Add them when a design specifies them.
