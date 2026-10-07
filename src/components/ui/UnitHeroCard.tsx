import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { DividedRow } from './DividedRow';
import { StatItem, type StatItemData } from './StatItem';

export interface UnitHeroCardProps {
  title: string;
  meta: string;
  stats: readonly StatItemData[];
  /** Relative widths of the stat columns; see DividedRow. */
  statWeights?: readonly number[];
  /** Shrinks the stat row on narrow screens; see StatItem `scale`. */
  statScale?: number;
  style?: StyleProp<ViewStyle>;
}

/** A little taller than the My Unit reference, for breathing room. */
const CARD_MIN_HEIGHT = 150;
/** The photo spans the right two thirds of the card's top, roughly its native 3:1. */
const PHOTO_WIDTH = '66%';
const PHOTO_HEIGHT = 90;
const STAT_GAP = 10;
const STAT_ICON_GAP = 8;

/**
 * The unit's headline card on the My Unit screen: name and summary over the
 * building photo, with key figures along the bottom.
 *
 * The photo is anchored top-right. Its fades span the whole card rather than
 * just the photo, so either side of every photo edge sits under the same navy
 * wash and no seam shows against the glass.
 */
export function UnitHeroCard({
  title,
  meta,
  stats,
  statWeights,
  statScale = 1,
  style,
}: UnitHeroCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Full strength past the photo's left edge, clear by the building.
  const sideScrim = useMemo(
    () => [theme.colors.scrimBottom, theme.colors.scrimBottom, theme.colors.transparent] as const,
    [theme],
  );
  // Clear at the top, full strength from the photo's bottom edge down.
  const bottomScrim = useMemo(
    () => [theme.colors.transparent, theme.colors.scrimBottom, theme.colors.scrimBottom] as const,
    [theme],
  );

  return (
    <GlassSurface
      radius={theme.borderRadius.md}
      glow
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      // The hero's glow runs corner to corner: violet bottom-left, cyan bottom-right.
      glowBottomColors={[theme.colors.featureStrokeTo, theme.colors.cardStrokeFrom]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={[styles.surface, style]}
    >
      {/* The glowing surface leaves its children unclipped, so the photo and
          its fades carry their own rounded clip. */}
      <View style={styles.media} pointerEvents="none">
        <View style={styles.photo}>
          <Image
            fadeDuration={0}
            source={images.unitPhoto}
            style={styles.photoImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
        <LinearGradient
          colors={[...sideScrim]}
          locations={[0, 0.4, 0.62]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[...bottomScrim]}
          // The photo's bottom edge sits at PHOTO_HEIGHT / CARD_MIN_HEIGHT.
          locations={[0.3, PHOTO_HEIGHT / CARD_MIN_HEIGHT, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.heading} accessibilityRole="header">
        <AppText variant="screenTitle">{title}</AppText>
        <AppText variant="statLabel" style={styles.meta}>
          {meta}
        </AppText>
      </View>

      <DividedRow weights={statWeights} gap={STAT_GAP * statScale} style={styles.stats}>
        {stats.map(({ id, ...stat }) => (
          <StatItem key={id} {...stat} iconGap={STAT_ICON_GAP} scale={statScale} />
        ))}
      </DividedRow>
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      minHeight: CARD_MIN_HEIGHT,
      justifyContent: 'space-between',
    },
    media: {
      ...StyleSheet.absoluteFill,
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
    },
    photo: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: PHOTO_WIDTH,
      height: PHOTO_HEIGHT,
      overflow: 'hidden',
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
    heading: {
      paddingTop: 18,
      paddingHorizontal: theme.spacing.md,
    },
    meta: {
      marginTop: 3,
    },
    stats: {
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
  });
}
