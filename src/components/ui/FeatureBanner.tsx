import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
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
  /** Type for `body`; the designs differ slightly between screens. */
  bodyVariant?: TypographyVariant;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png), with the extra room given to both screens: text on the left,
 * a photo on the right fading into the panel, and a carousel indicator.
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
  bodyVariant = 'tileSubtitle',
  style,
}: FeatureBannerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <NeonPanel
      // Darker than the other cards: the page's own navy, which the photo fades into.
      fill={theme.colors.backgroundDeep}
      // As on the My Unit hero: violet bottom-left, cyan bottom-right.
      glowBottomColors={[theme.colors.featureStrokeTo, theme.colors.cardStrokeFrom]}
      style={[styles.banner, style]}
    >
      <View style={styles.media} pointerEvents="none">
        <View style={[styles.photo, { width: Math.round(HEIGHT * photoAspect) }]}>
          <Image
            source={photo}
            style={styles.photoImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <LinearGradient
            colors={[theme.colors.backgroundDeep, theme.colors.transparent]}
            locations={[0, FADE_END]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>

      <AppText variant="bannerTitle" accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant={bodyVariant} color={theme.colors.textSupport} style={styles.body}>
        {body}
      </AppText>
      <View style={styles.indicator} accessibilityElementsHidden>
        <View style={styles.indicatorActive} />
      </View>
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    banner: {
      height: HEIGHT,
      paddingLeft: INSET_LEFT,
      paddingTop: INSET_TOP,
    },
    // The glowing surface leaves children unclipped, so the photo carries its
    // own rounded clip.
    media: {
      ...StyleSheet.absoluteFill,
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden',
    },
    photo: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
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
