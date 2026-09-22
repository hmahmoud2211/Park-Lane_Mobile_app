import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

interface StyleOptions {
  /** Short devices tighten up vertically so the CTA stays above the fold. */
  isCompact: boolean;
  headlineFontSize: number;
  headlineLineHeight: number;
  /** Diameter of the decorative corner arc. */
  arcSize: number;
}

/**
 * How far the arc's circle is pushed past the bottom-right corner, as a
 * fraction of its diameter. Large offsets keep only a shallow corner sweep on
 * screen; smaller ones would drag the curve across the middle of the layout.
 */
const ARC_OFFSET_RATIO = 0.68;

/**
 * Vertical measurements taken from the reference, expressed relative to the
 * safe area (the reference frame carries a 59dp status bar, which SafeAreaView
 * supplies at runtime).
 */
const EYEBROW_TOP = 26;
const EYEBROW_RULE_GAP = 4;
const EYEBROW_RULE_WIDTH = 32;
const HEADLINE_TO_CTA = 36;
const BOTTOM_INSET = 68;

export function createStyles(theme: AppTheme, options: StyleOptions) {
  const { isCompact, headlineFontSize, headlineLineHeight, arcSize } = options;
  const arcOffset = -arcSize * ARC_OFFSET_RATIO;

  return StyleSheet.create({
    content: {
      flex: 1,
      justifyContent: 'space-between',
      paddingTop: isCompact ? theme.spacing.md : EYEBROW_TOP,
      paddingBottom: isCompact ? theme.spacing.xl : BOTTOM_INSET,
    },

    // Top-left eyebrow
    eyebrow: {
      alignSelf: 'flex-start',
    },
    eyebrowRule: {
      height: 1,
      width: EYEBROW_RULE_WIDTH,
      marginTop: EYEBROW_RULE_GAP,
      backgroundColor: theme.colors.textSecondary,
    },

    // Bottom block: headline + CTA
    bottomBlock: {
      width: '100%',
    },
    headline: {
      marginBottom: isCompact ? theme.spacing.xxl : HEADLINE_TO_CTA,
    },
    headlineLine: {
      fontSize: headlineFontSize,
      lineHeight: headlineLineHeight,
    },

    // The CTA is inset slightly further than the text gutter, as in the design.
    cta: {
      marginHorizontal: theme.spacing.sm,
    },

    /**
     * Decorative corner sweep. The circle sits mostly past the bottom-right
     * corner so only a short arc crosses the screen, entering at the right edge
     * just above the CTA and leaving through the bottom edge.
     */
    glowArc: {
      position: 'absolute',
      right: arcOffset,
      bottom: arcOffset,
    },
  });
}
