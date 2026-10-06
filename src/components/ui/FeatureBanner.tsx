import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { NeonPanel } from './NeonPanel';

export interface FeatureBannerProps {
  title: string;
  body: string;
  photo: ImageSourcePropType;
  /** The photo's width over its height, so it is shown whole, never cropped. */
  photoAspect: number;
  /** Taller than the default for a longer body, e.g. Parking's three lines. */
  height?: number;
  /** Larger type for a headline banner, e.g. Smart Home's unit name; defaults to `screenTitle`. */
  titleVariant?: TypographyVariant;
  /** Defaults to `statLabel` in the soft accent colour; other variants are set in white. */
  bodyVariant?: TypographyVariant;
  /**
   * Drawn in place of the carousel indicator, e.g. Smart Home's round chevron
   * button. `null` drops the indicator and draws nothing, as on Amenities Booking.
   */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png), with the extra room given to both screens: text on the left,
 * a photo on the right fading into the panel, and a carousel indicator. The
 * text is set in My Unit's type, as are the rest of both screens.
 *
 * The panel is the My Unit glass, so, as on the My Unit hero, the navy wash
 * spans the whole card rather than just the photo: a solid strip up to the
 * photo, then fading out across it, so no seam shows against the glass. Laid
 * out with flex rather than measured, so it is right on the first frame.
 */
const HEIGHT = 116;
const INSET_LEFT = 18;
const INSET_TOP = 22;
const BODY_TOP = 6;
const INDICATOR_TOP = 14;
const INDICATOR_WIDTH = 30.5;
const INDICATOR_ACTIVE_WIDTH = 18;
const INDICATOR_HEIGHT = 2.5;
/** Fraction of the photo, from its left edge, over which it fades in. */
const FADE_END = 0.5;

/** The photo banner that opens the inner service screens. */
export function FeatureBanner({
  title,
  body,
  photo,
  photoAspect,
  height = HEIGHT,
  titleVariant = 'screenTitle',
  bodyVariant = 'statLabel',
  footer,
  style,
}: FeatureBannerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);
  const photoWidth = Math.round(height * photoAspect);

  return (
    <NeonPanel
      // As on the My Unit hero: violet bottom-left, cyan bottom-right.
      glowBottomColors={[theme.colors.featureStrokeTo, theme.colors.cardStrokeFrom]}
      style={[styles.banner, style]}
    >
      {/* Reversed, so the photo is anchored right and the wash fills the rest. */}
      <View style={styles.media} pointerEvents="none">
        <View style={[styles.photo, { width: photoWidth }]}>
          <Image
            source={photo}
            style={styles.photoImage}
            resizeMode="cover"
            fadeDuration={0}
            accessibilityIgnoresInvertColors
          />
          <LinearGradient
            colors={[theme.colors.scrimBottom, theme.colors.transparent]}
            locations={[0, FADE_END]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.wash} />
      </View>

      <AppText variant={titleVariant} accessibilityRole="header">
        {title}
      </AppText>
      <AppText
        variant={bodyVariant}
        color={bodyVariant === 'statLabel' ? theme.colors.textSupport : theme.colors.textPrimary}
        style={styles.body}
      >
        {body}
      </AppText>
      {footer !== undefined ? (
        footer
      ) : (
        <View style={styles.indicator} accessibilityElementsHidden>
          <View style={styles.indicatorActive} />
        </View>
      )}
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme, height: number) {
  return StyleSheet.create({
    banner: {
      height,
      paddingLeft: INSET_LEFT,
      paddingTop: INSET_TOP,
    },
    // The glowing surface leaves children unclipped, so the photo carries its
    // own rounded clip.
    media: {
      ...StyleSheet.absoluteFill,
      flexDirection: 'row-reverse',
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
    },
    photo: {
      flexShrink: 0,
    },
    wash: {
      flex: 1,
      backgroundColor: theme.colors.scrimBottom,
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    photoImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    body: {
      marginTop: BODY_TOP,
    },
    indicator: {
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      borderRadius: INDICATOR_HEIGHT / 2,
      marginTop: INDICATOR_TOP,
      backgroundColor: theme.colors.dividerSubtle,
      overflow: 'hidden',
    },
    indicatorActive: {
      width: INDICATOR_ACTIVE_WIDTH,
      height: '100%',
      borderRadius: INDICATOR_HEIGHT / 2,
      backgroundColor: theme.colors.electricCyan,
    },
  });
}
