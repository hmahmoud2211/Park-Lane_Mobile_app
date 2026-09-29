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

  /**
   * Derived from the My Unit screenshot (assets/Screens/screen4.png): a
   * photo-free backdrop, near-black navy with a blue glow behind the header.
   */
  backgroundDeep: '#00112C',
  backgroundGlow: '#012A6D',
  /** Column separators inside a card; bluer and fainter than `divider`. */
  dividerSubtle: 'rgba(127, 160, 255, 0.25)',

  /**
   * Status colours, first specified by the My Unit screen: the "Active"
   * handover dot and the month-on-month utility trends. `warning` is still
   * absent because no design shows one yet.
   */
  success: '#66E9A4',
  error: '#FC5848',

  /**
   * Visitor Access screen (assets/Screens/screen5.png), sampled from the
   * screenshot. Form fields sit darker than their card: `backgroundDeep` at
   * 40%. Their stroke measures exactly `dividerSubtle`.
   */
  fieldFill: 'rgba(0, 17, 44, 0.40)',
  /**
   * `textAccentSoft`, dimmed for the small supporting lines here: the design
   * face is thinner than Inter, so at full strength Inter reads brighter.
   */
  textSupport: 'rgba(169, 200, 255, 0.85)',
  /**
   * The screen's cards read as near-opaque navy, not tinted glass: sampled at
   * (0, 28, 65) against a page of (0, 14, 47).
   */
  panelFill: 'rgba(0, 29, 67, 0.90)',
  /** "Generate QR Pass": sky blue, royal blue, violet, pink at even stops. */
  ctaSky: '#0096FF',
  ctaRoyal: '#0248DE',
  ctaViolet: '#6634E6',
  ctaPink: '#E650FF',
  /** Initials chips in the visitor list: a blue-tinted disc and ring. */
  avatarFill: 'rgba(43, 140, 255, 0.25)',
  avatarStroke: 'rgba(127, 160, 255, 0.50)',
  /**
   * Visitor status chips. Opaque, as drawn: each sits on a card of known
   * colour. Teal marks "Arrived" and the active pass, violet "Scheduled" (its
   * stroke runs blue into violet) and slate "Entered".
   */
  chipTealText: '#6FF8E2',
  chipTealFill: '#01333B',
  chipTealStroke: '#0A9A98',
  chipVioletText: '#BEAAEA',
  chipVioletFill: '#0D1D56',
  chipVioletStrokeFrom: '#3D5CB9',
  chipVioletStrokeTo: '#7048BF',
  chipSlateText: '#E2E8F0',
  chipSlateFill: '#0B2146',
  chipSlateStroke: '#3D619C',

  /**
   * Maintenance screen (assets/Screens/screen6.png), sampled from the
   * screenshot. `stepActive` is the current stage of a request's progress
   * track; `badgeFill` backs an icon tile, a shade lighter than its panel.
   */
  stepActive: '#A526FC',
  badgeFill: 'rgba(43, 140, 255, 0.08)',
  /** Emergency Support: the warning glyph, the "Call Now" pill and a faint wash. */
  emergencyIcon: '#FF5C7A',
  emergencyStroke: '#E04A6B',
  emergencyFill: '#311634',
  emergencyText: '#FFE6E4',
  emergencyWash: 'rgba(255, 77, 109, 0.12)',

  transparent: 'transparent',
} as const;
