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

  /**
   * Parking screen (assets/Screens/screen7.png), sampled from the screenshot.
   * The two filled action buttons are lit from their edges, so each fill runs
   * edge, core, edge from left to right. "Navigate to My Car" takes
   * `electricCyan` for its rim; "Request Guest Parking" has a lavender one.
   */
  actionBlueFrom: '#0074EA',
  actionBlueVia: '#003593',
  actionBlueTo: '#003AAE',
  actionVioletFrom: '#332199',
  actionVioletVia: '#191F79',
  actionVioletTo: '#2D1F82',
  actionVioletStroke: '#986FF9',

  /**
   * Community screen (assets/Screens/screen8.png), sampled from the
   * screenshot. The "Register" pill is a brighter cousin of the violet chip:
   * a royal-blue fill, its rim running blue into lavender, white text.
   */
  chipIndigoFill: '#0F2776',
  chipIndigoStrokeFrom: '#236CC8',
  chipIndigoStrokeTo: '#8762BD',

  /**
   * Smart Home screen (assets/Screens/screen9.png, screen10.png), sampled
   * from the screenshots. Lit fixtures (bulb, curtains, the Scenes star and
   * the energy icons) glow a warm yellow; the active scene is rimmed in amber.
   */
  iconWarm: '#FFE98A',
  sceneActive: '#F5B240',
  /** The AC snowflake: a pale ice blue. */
  iconCool: '#9EDCFF',
  /** Toggle switches when on: a bright blue pill lit a little more at the knob end. */
  toggleOnFrom: '#0091FE',
  toggleOnTo: '#00A5FE',
  /** Brightness slider: a pale gold running into warm white. */
  sliderWarmFrom: '#F8D778',
  sliderWarmTo: '#F8F7EF',
  /** Light colour presets, left to right: warm, amber, daylight, blue, violet. */
  lightWarm: '#FECB74',
  lightAmber: '#FDA541',
  lightDaylight: '#E3F0FE',
  lightBlue: '#0AA7FF',
  lightViolet: '#A03CFD',
  /** Hues around the custom-colour ring, from the top going clockwise. */
  hueRed: '#FF3B5C',
  hueOrange: '#FF9F2E',
  hueYellow: '#FFE93D',
  hueGreen: '#2EF07A',
  hueCyan: '#00E0FF',
  hueBlue: '#2B6BFF',
  hueMagenta: '#C23DFF',
  /** The well behind the colour presets, and the AC's unlit fan bars. */
  wellFill: 'rgba(11, 44, 100, 0.55)',
  levelOff: '#183261',
  /** The energy gauge's arc and its "down on yesterday" trend. */
  energyArc: '#00FCF2',
  energyArcTrack: 'rgba(17, 53, 95, 0.90)',
  energyArcGlow: 'rgba(0, 252, 242, 0.22)',
  energyTrendDown: '#00F5C8',
  /** A device's "Online" dot. */
  online: '#01FBC2',

  /**
   * Assistant screen. No design exists for it yet, so everything here is
   * derived from the palette above rather than sampled.
   *
   * The orb is built from the palette's four glows. Its halo fades from
   * `electricCyan` (listening) or `magenta` (speaking) to nothing.
   */
  orbHaloListen: 'rgba(25, 215, 255, 0.42)',
  orbHaloSpeak: 'rgba(212, 75, 255, 0.40)',
  orbHaloEdge: 'rgba(43, 140, 255, 0.00)',
  orbBlobCyan: 'rgba(25, 215, 255, 0.95)',
  orbBlobMagenta: 'rgba(212, 75, 255, 0.85)',
  orbGloss: 'rgba(255, 255, 255, 0.55)',
  orbGlossEdge: 'rgba(255, 255, 255, 0.00)',
  orbRing: 'rgba(25, 215, 255, 0.55)',
  orbRingSpeak: 'rgba(212, 75, 255, 0.55)',
  /** An answer bubble: `midnightBlue` at 60%, so it reads over any backdrop. */
  bubbleFill: 'rgba(10, 37, 94, 0.60)',
  bubbleStroke: 'rgba(127, 160, 255, 0.30)',
  /**
   * `warning` marks stale building data ("possibly offline"). It is the
   * first amber in the system, kept soft so it sits beside the cyan.
   */
  warning: '#FFC861',
  warningFill: 'rgba(255, 200, 97, 0.12)',
  warningStroke: 'rgba(255, 200, 97, 0.45)',
  errorFill: 'rgba(252, 88, 72, 0.12)',
  errorStroke: 'rgba(252, 88, 72, 0.50)',
  successFill: 'rgba(102, 233, 164, 0.12)',
  successStroke: 'rgba(102, 233, 164, 0.45)',
  infoFill: 'rgba(25, 215, 255, 0.10)',
  infoStroke: 'rgba(25, 215, 255, 0.40)',
  /** The red hang-up button, lit from the top like the CTAs. */
  hangUpFrom: '#FF5C7A',
  hangUpTo: '#D7264F',
  /** Fades the caption list into the page at its top edge. */
  fadeDeep: 'rgba(0, 17, 44, 0.00)',
  /** The camera preview's frame while it waits for its first picture. */
  cameraFill: 'rgba(0, 17, 44, 0.85)',
  scanLine: 'rgba(25, 215, 255, 0.85)',
  scanGlow: 'rgba(25, 215, 255, 0.00)',

  /**
   * Bottom navigation bar, built from the existing brand colours. The raised
   * Home disc takes the CTA gradient (`ctaSky` -> `ctaPink`) and sits in a
   * `midnightBlue` seat; its halo is the Glass frame gradient (#4F7BFF ->
   * #FF5CCB) at 30%, rimmed by a faint white hairline.
   */
  navHomeSeat: palette.midnightBlue,
  navHaloFrom: 'rgba(79, 123, 255, 0.30)',
  navHaloTo: 'rgba(255, 92, 203, 0.30)',
  navHaloStroke: 'rgba(255, 255, 255, 0.18)',
  /** Specular highlight across the top of the Home disc. */
  navGloss: 'rgba(255, 255, 255, 0.38)',
  navGlossEdge: 'rgba(255, 255, 255, 0.00)',
  /** Inactive tab icon and label; the active tab is full white with a gradient label. */
  navLabel: 'rgba(255, 255, 255, 0.60)',
  /**
   * The side rail tablets and desktops get instead of the bar: the active
   * item sits on the Home halo's gradient, a pointer hover on a white wash.
   */
  navActiveFrom: 'rgba(79, 123, 255, 0.26)',
  navActiveTo: 'rgba(255, 92, 203, 0.14)',
  navHover: 'rgba(255, 255, 255, 0.07)',

  /**
   * Visitor parking, gate and EV charging demo. No design exists yet, so these
   * extend existing roles: the amber and red chips are `warning` and `error`
   * set like the teal and violet chips (dark fill, lit rim, pale text), and
   * the site map is drawn in the cards' navy and blue hairlines.
   */
  chipAmberText: '#FFD58A',
  chipAmberFill: '#33260A',
  chipAmberStroke: '#B88A2E',
  chipRedText: '#FFB4AA',
  chipRedFill: '#3A1117',
  chipRedStroke: '#C2434F',
  mapGround: 'rgba(0, 17, 44, 0.80)',
  mapRoad: 'rgba(127, 160, 255, 0.20)',
  mapBuilding: 'rgba(43, 140, 255, 0.14)',
  mapBuildingStroke: 'rgba(127, 160, 255, 0.55)',
  mapBasement: 'rgba(122, 77, 255, 0.10)',
  mapBasementStroke: 'rgba(152, 111, 249, 0.55)',
  mapBay: 'rgba(255, 255, 255, 0.08)',
  mapBayStroke: 'rgba(255, 255, 255, 0.30)',
  /** Bays as a lit garage: an empty bay glows green, an occupied one red around a parked car. */
  mapBayFree: 'rgba(102, 233, 164, 0.10)',
  mapBayFreeStroke: 'rgba(102, 233, 164, 0.95)',
  mapBayFreeGlow: 'rgba(102, 233, 164, 0.28)',
  mapBayTaken: 'rgba(252, 88, 72, 0.12)',
  mapBayTakenStroke: 'rgba(252, 88, 72, 0.90)',
  mapBayTakenGlow: 'rgba(252, 88, 72, 0.26)',
  mapTarget: palette.electricCyan,
  mapRoute: palette.electricCyan,
  mapRouteDim: 'rgba(25, 215, 255, 0.35)',
  mapRouteGlow: 'rgba(25, 215, 255, 0.22)',
  mapGate: '#FFC861',
  /** The compound wall, asphalt, kerbs and lane markings. */
  mapBoundary: 'rgba(127, 160, 255, 0.50)',
  mapAsphalt: 'rgba(14, 30, 66, 0.98)',
  mapRoadEdge: 'rgba(169, 200, 255, 0.40)',
  mapLaneMark: 'rgba(255, 255, 255, 0.45)',
  mapSidewalk: 'rgba(169, 200, 255, 0.12)',
  /** Gardens, the pool and the basement floor plates. */
  mapGreen: 'rgba(102, 233, 164, 0.10)',
  mapGreenStroke: 'rgba(102, 233, 164, 0.40)',
  mapWater: 'rgba(25, 215, 255, 0.18)',
  mapWaterStroke: 'rgba(25, 215, 255, 0.50)',
  mapFloor: 'rgba(10, 37, 94, 0.60)',
  mapColumn: 'rgba(169, 200, 255, 0.40)',
  mapLift: 'rgba(122, 77, 255, 0.30)',
  /** Zones are outlined in faint blue; bays nobody can book are barely drawn. */
  mapZone: 'rgba(43, 140, 255, 0.07)',
  mapZoneStroke: 'rgba(43, 140, 255, 0.50)',
  mapBayOther: 'rgba(255, 255, 255, 0.04)',
  mapBayOtherStroke: 'rgba(255, 255, 255, 0.16)',
  /** A bay reserved right now, and the walking route: the system's amber and green. */
  mapBayReserved: 'rgba(226, 232, 240, 0.06)',
  mapBayReservedStroke: 'rgba(226, 232, 240, 0.75)',
  /** Diagonal hatching across a reserved bay. */
  mapBayHatch: 'rgba(226, 232, 240, 0.45)',
  /** Parked cars seen from above: three paint shades and dark glass. */
  mapCarLight: 'rgba(226, 232, 240, 0.95)',
  mapCarMid: 'rgba(148, 163, 184, 0.95)',
  mapCarDark: 'rgba(71, 85, 105, 0.98)',
  mapCarGlass: 'rgba(7, 27, 68, 0.88)',
  mapCarTail: 'rgba(252, 88, 72, 0.95)',
  /** The garage's wall lights. */
  mapLight: 'rgba(255, 214, 140, 0.95)',
  mapLightGlow: 'rgba(255, 200, 97, 0.22)',
  mapWalk: '#66E9A4',
  mapWalkGlow: 'rgba(102, 233, 164, 0.24)',
  /** The QR's quiet zone must be light for scanners. */
  qrBackground: palette.white,
  qrForeground: palette.deepNavy,

  transparent: 'transparent',
} as const;
