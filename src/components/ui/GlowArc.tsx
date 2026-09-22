import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface GlowArcProps {
  /** Diameter of the arc's circle. Only the part on screen is visible. */
  size: number;
  /** Brightness of the stroke, 0-1. */
  intensity?: number;
  /** Position the circle, typically with negative offsets so it overhangs. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The curved neon sweep in the screen corners. A large circle positioned mostly
 * off-screen, so only an arc of its edge shows.
 *
 * A bright stroke over a wider, fainter one, plus a coloured shadow for the
 * halo. Nothing is painted inside the circle, so the photo shows through.
 *
 * Purely decorative: excluded from touch and from the accessibility tree.
 */
export function GlowArc({ size, intensity = 1, style }: GlowArcProps) {
  const theme = useAppTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // Sized here so the rings have a box to fill; callers only position it.
        root: {
          width: size,
          height: size,
        },
        halo: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 7,
          borderColor: theme.colors.glowInner,
          opacity: 0.25 * intensity,
        },
        stroke: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: theme.colors.accent,
          opacity: 0.85 * intensity,
          shadowColor: theme.colors.accent,
          shadowOpacity: 0.8 * intensity,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        },
      }),
    [size, intensity, theme],
  );

  return (
    <View
      style={[styles.root, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.halo} />
      <View style={styles.stroke} />
    </View>
  );
}
