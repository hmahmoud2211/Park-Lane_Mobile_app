import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useLayoutSize } from '../../hooks/useLayoutSize';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { NeonPanel } from './NeonPanel';
import { PanelHeading } from './PanelHeading';

/**
 * `backdrop` is a scene filling the card's height at the right, fading into
 * the panel on its left. `cutout` is an object on a transparent background,
 * kept at `cutoutHeight` beside the chevron, whatever the card's height.
 */
export type PhotoCardLayout = 'backdrop' | 'cutout';

export interface PhotoCardProps {
  /** The heading, e.g. "My Parking". */
  title: string;
  /** Drawn at the start of the heading. */
  icon: ReactNode;
  /** The card's main line, e.g. "Slot P2-148". */
  headline: string;
  /** The line under it, e.g. "Tower A • Basement 2". */
  meta: string;
  photo: ImageSourcePropType;
  /** The photo's width over its height, so it is laid out whole. */
  photoAspect: number;
  photoLayout?: PhotoCardLayout;
  cutoutHeight?: number;
  /** Makes the whole card a button, shown by its trailing chevron. */
  onPress?: () => void;
  accessibilityHint?: string;
  /** Under the meta line, e.g. a StatusChip. */
  children?: ReactNode;
  /**
   * Shrinks the headline, meta and a cutout together, for cards narrower
   * than the design's, so the text stays clear of the photo. 1 is the
   * reference size.
   */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Parking design (assets/Screens/screen7.png), with the extra room
 * the inner screens are given: a PanelHeading whose divider stops where the
 * photo takes over, then the text in the left part of the card.
 */
const TEXT_COLUMN = '56%';
/** The divider runs from the heading's inset to the end of the text column. */
const DIVIDER_END = '44%';
const BODY_INSET_LEFT = 14;
const BODY_TOP = 6;
const META_TOP = 1;
const FOOTER_TOP = 8;
const BODY_BOTTOM = 12;
/** Fraction of a backdrop photo, from its left edge, over which it fades in. */
const FADE_END = 0.5;
/**
 * A backdrop never starts closer than this to the card's left edge. It stays
 * anchored right, so on a narrow card its left part gives way to the wash
 * rather than sliding in behind the text.
 */
const BACKDROP_MIN_LEFT = 72;
const CUTOUT_HEIGHT = 62;
/** Keeps a cutout clear of the chevron, as drawn. */
const CUTOUT_INSET_RIGHT = 20;
const CUTOUT_INSET_RIGHT_BARE = 8;
const CHEVRON_SIZE = 14;
const CHEVRON_INSET_RIGHT = 10;

/** A titled card with a photo at the right, e.g. the resident's parking bay or car. */
export function PhotoCard({
  title,
  icon,
  headline,
  meta,
  photo,
  photoAspect,
  photoLayout = 'backdrop',
  cutoutHeight = CUTOUT_HEIGHT,
  onPress,
  accessibilityHint,
  children,
  scale = 1,
  style,
}: PhotoCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const isBackdrop = photoLayout === 'backdrop';
  // A backdrop is as tall as the card, so its width follows the card's height.
  const { ref, size, onLayout } = useLayoutSize(isBackdrop);
  const photoWidth = Math.round(size.height * photoAspect);

  const media = isBackdrop ? (
    // Reversed, so the photo is anchored right and the wash fills the rest.
    <View ref={ref} onLayout={onLayout} style={styles.media} pointerEvents="none">
      {size.height > 0 ? (
        <>
          <View
            style={[
              styles.photo,
              { width: Math.max(0, Math.min(photoWidth, size.width - BACKDROP_MIN_LEFT)) },
            ]}
          >
            <Image
              source={photo}
              style={[styles.photoImage, { width: photoWidth }]}
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
        </>
      ) : null}
    </View>
  ) : (
    <View
      style={[
        styles.cutoutFrame,
        { right: onPress ? CUTOUT_INSET_RIGHT : CUTOUT_INSET_RIGHT_BARE },
      ]}
      pointerEvents="none"
    >
      <Image
        source={photo}
        style={{ height: cutoutHeight * scale, width: cutoutHeight * scale * photoAspect }}
        resizeMode="contain"
        fadeDuration={0}
        accessibilityIgnoresInvertColors
      />
    </View>
  );

  const card = (
    <NeonPanel style={onPress ? undefined : style}>
      {media}

      <PanelHeading title={title} icon={icon} dividerStyle={styles.headingDivider} />

      <View style={styles.body}>
        <AppText variant="sectionTitle" numberOfLines={1} style={styles.headline}>
          {headline}
        </AppText>
        <AppText
          variant="statLabel"
          color={theme.colors.textSupport}
          numberOfLines={2}
          style={styles.meta}
        >
          {meta}
        </AppText>
        {children ? <View style={styles.footer}>{children}</View> : null}
      </View>

      {onPress ? (
        <View style={styles.chevron} pointerEvents="none">
          <Ionicons name="chevron-forward" size={CHEVRON_SIZE} color={theme.colors.textPrimary} />
        </View>
      ) : null}
    </NeonPanel>
  );

  if (!onPress) {
    return card;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${headline}, ${meta}`}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {card}
    </Pressable>
  );
}

function createStyles(theme: AppTheme, scale: number) {
  // Type overrides only when scaled, so the reference size is the token itself.
  const sized = (variant: TypographyVariant): TextStyle => {
    const { fontSize, lineHeight } = theme.typography[variant] as TextStyle;
    return scale === 1 || fontSize === undefined || lineHeight === undefined
      ? {}
      : { fontSize: fontSize * scale, lineHeight: lineHeight * scale };
  };

  return StyleSheet.create({
    // The glowing surface leaves children unclipped, so the photo carries its
    // own rounded clip, following the NeonPanel's corners.
    media: {
      ...StyleSheet.absoluteFill,
      flexDirection: 'row-reverse',
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
    },
    // Clips the photo's left part where the card is too narrow for all of it.
    photo: {
      flexShrink: 0,
      overflow: 'hidden',
    },
    // Anchored right at its full width. Explicit sizes rather than
    // absoluteFill: react-native-web stamps the image's intrinsic size onto the
    // element, which beats inset-0 alone.
    photoImage: {
      position: 'absolute',
      top: 0,
      right: 0,
      height: '100%',
    },
    headline: sized('sectionTitle'),
    wash: {
      flex: 1,
      backgroundColor: theme.colors.scrimBottom,
    },
    cutoutFrame: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
    headingDivider: {
      right: DIVIDER_END,
    },
    body: {
      width: TEXT_COLUMN,
      paddingLeft: BODY_INSET_LEFT,
      paddingTop: BODY_TOP,
      paddingBottom: BODY_BOTTOM,
    },
    meta: {
      ...sized('statLabel'),
      marginTop: META_TOP,
    },
    footer: {
      flexDirection: 'row',
      marginTop: FOOTER_TOP,
    },
    chevron: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      right: CHEVRON_INSET_RIGHT,
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
