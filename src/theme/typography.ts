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
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
