import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface ParkingSignProps {
  /** Width and height of the box. */
  size: number;
  /** Defaults to the primary text colour. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Proportions of the boxed "P" first drawn on Visitor Access: a 26dp box
 * with 4.5dp corners around `body` type. The stroke stays at 1.25dp at every
 * size, as the Parking design (assets/Screens/screen7.png) draws it.
 */
const REFERENCE_SIZE = 26;
const REFERENCE_RADIUS = 4.5;
const STROKE_WIDTH = 1.25;

/**
 * The parking sign: a "P" in a rounded box. Drawn rather than taken from an
 * icon set, whose boxed P has heavier strokes than the design.
 */
export function ParkingSign({ size, color, style }: ParkingSignProps) {
  const theme = useAppTheme();
  const tint = color ?? theme.colors.textPrimary;
  const styles = useMemo(() => createStyles(theme, size), [theme, size]);

  return (
    <View style={[styles.box, { borderColor: tint }, style]} accessibilityElementsHidden>
      <AppText variant="body" color={tint} style={styles.letter}>
        P
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme, size: number) {
  const ratio = size / REFERENCE_SIZE;
  const { fontSize, lineHeight } = theme.typography.body;

  return StyleSheet.create({
    box: {
      width: size,
      height: size,
      borderRadius: REFERENCE_RADIUS * ratio,
      borderWidth: STROKE_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    letter: {
      fontSize: fontSize * ratio,
      lineHeight: lineHeight * ratio,
    },
  });
}
