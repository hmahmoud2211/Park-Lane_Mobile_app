import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useRef, type PropsWithChildren } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageResizeMode,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { BlurTargetContext } from './BlurTarget';

export interface AppBackgroundProps extends PropsWithChildren {
  /** `null` draws no photo, for screens whose backdrop is painted in code. */
  source?: ImageSourcePropType | null;
  resizeMode?: ImageResizeMode;
  /** Darkens the top and bottom so text stays legible over the photo. */
  withScrim?: boolean;
  /** Flat darkening over the whole photo, 0-1, for content-dense screens. */
  overlay?: number;
  /**
   * Pins the photo's bottom edge to the screen's, at full width, instead of
   * cropping it about the centre. For a portrait photo whose subject sits at
   * the bottom, on a screen wider than the photo: a landscape tablet would
   * otherwise show only the sky. Pass the photo's width over its height.
   */
  bottomAnchorAspect?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Full-bleed photo background with a legibility scrim.
 *
 * Uses an absolutely filled <Image> rather than <ImageBackground>: the latter
 * sizes its inner image from `style.width`/`style.height`, which a `flex: 1`
 * container does not provide, so the image falls back to its intrinsic size
 * and the crop goes wrong. absoluteFill pins it to the container instead.
 *
 * The photo and its shading sit in a BlurTargetView, which the glass panels
 * among `children` blur on Android (see BlurTarget). The children stay outside
 * it, as a target that contained its own blur views would sample itself.
 */
export function AppBackground({
  source = images.mainBackground,
  resizeMode = 'cover',
  withScrim = true,
  overlay = 0,
  bottomAnchorAspect,
  style,
  children,
}: AppBackgroundProps) {
  const theme = useAppTheme();
  const blurTarget = useRef<View>(null);

  // Fading between two alphas of the same colour, rather than to `transparent`,
  // avoids the grey midpoint Android interpolates through.
  const scrimColors = useMemo(
    () =>
      [
        theme.colors.scrimTop,
        theme.colors.transparent,
        theme.colors.transparent,
        theme.colors.scrimBottom,
      ] as const,
    [theme],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }, style]}>
      <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill} pointerEvents="none">
        {source ? (
          <Image
            fadeDuration={0}
            source={source}
            resizeMode={resizeMode}
            style={
              bottomAnchorAspect
                ? [styles.imageBottom, { aspectRatio: bottomAnchorAspect }]
                : styles.image
            }
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {overlay > 0 ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: theme.colors.black, opacity: overlay },
            ]}
            pointerEvents="none"
          />
        ) : null}
        {withScrim ? (
          <LinearGradient
            colors={[...scrimColors]}
            locations={[0, 0.22, 0.5, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
      </BlurTargetView>
      <BlurTargetContext.Provider value={blurTarget}>{children}</BlurTargetContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Explicit 100% beats the intrinsic width/height react-native-web stamps
    // onto the element, which would otherwise win over inset-0 alone.
    width: '100%',
    height: '100%',
  },
  imageBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    // Never shorter than the screen, so no band shows above a short photo.
    minHeight: '100%',
  },
});
