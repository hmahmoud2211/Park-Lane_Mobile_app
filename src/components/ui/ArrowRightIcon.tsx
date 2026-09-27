import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface ArrowRightIconProps {
  size?: number;
  color?: string;
  thickness?: number;
  /** Length of each head stroke as a fraction of `size`. */
  headRatio?: number;
}

/**
 * A thin right arrow drawn from three bars.
 *
 * Built from Views rather than an icon font. Other glyphs come from
 * @expo/vector-icons, but its arrows are drawn far heavier than the hairline
 * arrows in the designs, so this one stays hand-built; mirrored, it is also
 * the bare back arrow (see BackButton's `arrow` variant).
 */
export function ArrowRightIcon({
  size = 16,
  color,
  thickness = 1.5,
  headRatio = 0.42,
}: ArrowRightIconProps) {
  const theme = useAppTheme();
  const strokeColor = color ?? theme.colors.textPrimary;
  const headLength = size * headRatio;

  const styles = useMemo(() => {
    const bar = {
      position: 'absolute' as const,
      height: thickness,
      borderRadius: thickness / 2,
      backgroundColor: strokeColor,
      top: (size - thickness) / 2,
    };

    return StyleSheet.create({
      container: { width: size, height: size },
      shaft: { ...bar, left: 0, width: size },
      // Rotated about the tip, so both bars meet the shaft's right end exactly.
      headTop: {
        ...bar,
        right: 0,
        width: headLength,
        transformOrigin: 'right center',
        transform: [{ rotate: '45deg' }],
      },
      headBottom: {
        ...bar,
        right: 0,
        width: headLength,
        transformOrigin: 'right center',
        transform: [{ rotate: '-45deg' }],
      },
    });
  }, [size, thickness, strokeColor, headLength]);

  return (
    <View style={styles.container}>
      <View style={styles.shaft} />
      <View style={styles.headTop} />
      <View style={styles.headBottom} />
    </View>
  );
}
