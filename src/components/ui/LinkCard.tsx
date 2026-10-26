import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import type { IconSet } from './ServiceTile';
import { NeonPanel } from './NeonPanel';

/** An illustration, or a glyph drawn in the primary text colour. */
export type LinkCardIcon = { image: ImageSourcePropType } | { set: IconSet; name: string };

export type LinkCardSize = 'regular' | 'compact';

export interface LinkCardProps {
  title: string;
  description: string;
  icon: LinkCardIcon;
  /** `regular` is the Services row; `compact` the shorter Settings row. */
  size?: LinkCardSize;
  /** Grows to the height of its grid row, so cards side by side line up. */
  fill?: boolean;
  onPress: () => void;
}

interface Metrics {
  minHeight: number;
  paddingVertical: number;
  tileInset: number;
  tileSize: number;
  /** An illustration fills the tile inside its stroke; a glyph sits centred. */
  iconSize: number;
  tileToText: number;
  titleVariant: TypographyVariant;
  descriptionLines: number;
  chevronSize: number;
  chevronInset: number;
}

/*
 * `regular`, from the Services reference (assets/Screens/screen12.png): a 74dp
 * card, the illustration in a 52dp tile 20dp in, the text 30dp beyond it.
 * `compact`, from the Settings reference (assets/Screens/screen13.png): a
 * 49dp card, a 17dp glyph in a 36dp tile 15dp in, the text 22dp beyond it.
 * Both are a little taller here for the inner screens' roomier rhythm.
 */
const METRICS: Record<LinkCardSize, Metrics> = {
  regular: {
    minHeight: 78,
    paddingVertical: 13,
    tileInset: 20,
    tileSize: 52,
    iconSize: 50,
    tileToText: 30,
    titleVariant: 'sectionTitle',
    descriptionLines: 3,
    chevronSize: 17,
    chevronInset: 13,
  },
  compact: {
    minHeight: 56,
    paddingVertical: 10,
    tileInset: 15,
    tileSize: 36,
    iconSize: 19,
    tileToText: 22,
    titleVariant: 'statValue',
    descriptionLines: 2,
    chevronSize: 15,
    chevronInset: 15,
  },
};
const TITLE_TO_DESCRIPTION = 3;

/**
 * A neon card that opens something: an icon tile, a title, a short summary
 * and a chevron. The rows of the Services and Settings screens.
 */
export function LinkCard({ title, description, icon, size = 'regular', fill = false, onPress }: LinkCardProps) {
  const theme = useAppTheme();
  const metrics = METRICS[size];
  const styles = useMemo(() => createStyles(theme, metrics), [theme, metrics]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description.replace(/\n/g, ' ')}`}
      style={({ pressed }) => [fill && styles.fill, pressed && styles.pressed]}
    >
      <NeonPanel style={[styles.card, fill && styles.fill]}>
        <View style={styles.tile}>
          {'image' in icon ? (
            <Image
              source={icon.image}
              style={styles.image}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <AppIcon set={icon.set} name={icon.name} size={metrics.iconSize} />
          )}
        </View>

        <View style={styles.text}>
          <AppText variant={metrics.titleVariant} numberOfLines={1}>
            {title}
          </AppText>
          <AppText
            variant="statLabel"
            color={theme.colors.textSupport}
            numberOfLines={metrics.descriptionLines}
            style={styles.description}
          >
            {description}
          </AppText>
        </View>

        <Ionicons
          name="chevron-forward"
          size={metrics.chevronSize}
          color={theme.colors.textPrimary}
        />
      </NeonPanel>
    </Pressable>
  );
}

function createStyles(theme: AppTheme, metrics: Metrics) {
  return StyleSheet.create({
    fill: {
      flexGrow: 1,
    },
    card: {
      minHeight: metrics.minHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: metrics.paddingVertical,
      paddingLeft: metrics.tileInset,
      paddingRight: metrics.chevronInset,
    },
    tile: {
      width: metrics.tileSize,
      height: metrics.tileSize,
      borderRadius: theme.borderRadius.sm,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    image: {
      width: metrics.iconSize,
      height: metrics.iconSize,
    },
    text: {
      flex: 1,
      marginLeft: metrics.tileToText,
      marginRight: theme.spacing.sm,
    },
    description: {
      marginTop: TITLE_TO_DESCRIPTION,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
