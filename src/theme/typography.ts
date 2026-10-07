import type { TextStyle } from 'react-native';

/**
 * Inter, loaded at runtime via @expo-google-fonts/inter.
 * Weights are selected by family name, never by `fontWeight`, so that
 * Android renders the correct cut instead of synthesising one.
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const typography = {
  /** "Smart / Community / Living" on screen 1. */
  displayLarge: {
    fontFamily: fontFamily.bold,
    fontSize: 29,
    lineHeight: 32,
    letterSpacing: 0,
  },
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  subheading: {
    fontFamily: fontFamily.semiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  /** Letterspaced caps, e.g. "MORE / THAN A HOME". */
  overline: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  /** The profile screen's title. */
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
  },
  /** Service tile title. */
  tileTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9.5,
    lineHeight: 13,
  },
  /** The profile pass caption. */
  tileSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 7.5,
    lineHeight: 10.5,
  },
  /** Supporting line under a heading, links and small labels. */
  bodySmall: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
  },
  /** Sentence-case button label, e.g. the login screen's "Sign in". */
  buttonSoft: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Caption inside a form field, e.g. "Email or Username". */
  inputLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },
  /** The typed value inside a form field. */
  inputValue: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  /** "GET STARTED". */
  button: {
    fontFamily: fontFamily.bold,
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /*
   * My Unit screen (assets/Screens/screen4.png). The design face is narrower
   * than Inter, so these sizes were solved against the measured text widths.
   * Home, Visitor Access and Maintenance are set in these too, so the
   * screens share one type.
   */

  /** Title beside a back arrow, e.g. "My Unit". */
  screenTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
  },
  /** The unit name on the hero card. */
  heroTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20.5,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  /** "3 Bedrooms • Tower A • Floor 3". */
  heroSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Card headings, e.g. "Unit Overview". */
  sectionTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  /** Caption above a figure, e.g. "Building", "Unit Price". */
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 8,
    lineHeight: 11,
  },
  /** The figure itself, e.g. "Tower A", "EGP 145,000". */
  statValue: {
    fontFamily: fontFamily.medium,
    fontSize: 9.5,
    lineHeight: 13,
  },
  /** Headline figures, e.g. the unit price row. */
  statValueLarge: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  /** Supporting line on a compact tile, e.g. "View & download". */
  tileCaption: {
    fontFamily: fontFamily.regular,
    fontSize: 7,
    lineHeight: 10,
  },

  /*
   * Assistant screen, set in the same sizes as Visitor Access and the other
   * inner screens (the Visitor Access token each one matches is named). Line
   * heights run a little taller where answers wrap, since Arabic (drawn in
   * the system fallback face) needs the taller line box.
   */

  /** "How can I help?" over the empty chat: `screenTitle`, the banner title. */
  assistantTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
  },
  /** A message bubble's text: `statValue`'s size. */
  chatBody: {
    fontFamily: fontFamily.regular,
    fontSize: 9.5,
    lineHeight: 15,
  },
  /** A `###` heading inside an answer: `sectionTitle`. */
  chatHeading: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  /** Sender line and timestamps around a bubble: `tileCaption`. */
  chatMeta: {
    fontFamily: fontFamily.regular,
    fontSize: 7,
    lineHeight: 10,
  },
  /** Suggestion chips, badges and segmented-control labels: `statValue`. */
  chipLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9.5,
    lineHeight: 13,
  },
  /** The assistant's live spoken reply: `screenTitle`'s size. */
  voiceCaption: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  /** The resident's own words, above the reply: `statValue`'s size. */
  voiceCaptionMuted: {
    fontFamily: fontFamily.regular,
    fontSize: 9.5,
    lineHeight: 15,
  },
  /** "LISTENING", "SPEAKING" in the status pill: `statLabel`'s size. */
  voiceStatus: {
    fontFamily: fontFamily.semiBold,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  /** Bottom navigation labels, e.g. "EMS AI", "HOME". */
  navLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 8.5,
    lineHeight: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
