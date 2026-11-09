import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { clamp } from '../../utils/responsive';

export interface HealthRingProps {
  /** Share of systems reporting healthy, 0-1. */
  fraction: number;
  /** e.g. "89%". */
  label: string;
  size: number;
  stroke: number;
}

/*
 * As drawn on the reference: the arc's open end sits at about one o'clock and
 * it runs anticlockwise through the top, cyan at the top fading into lavender
 * at the bottom right, with round caps and no track behind it.
 */
const END_DEGREES = 40;

/** A point on the ring, `degrees` clockwise from the top. */
function point(c: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: c + r * Math.sin(radians), y: c - r * Math.cos(radians) };
}

/** The System Health dial: an arc as long as the healthy share, with the figure inside. */
export function HealthRing({ fraction, label, size, stroke }: HealthRingProps) {
  const theme = useAppTheme();
  const gradientId = `health-${useId().replace(/:/g, '')}`;

  const c = size / 2;
  const r = (size - stroke) / 2;
  const sweep = 360 * clamp(fraction, 0, 0.999);
  // Clockwise from the start to the open end at one o'clock.
  const start = END_DEGREES - sweep;
  const a = point(c, r, start);
  const b = point(c, r, END_DEGREES);
  const large = sweep > 180 ? 1 : 0;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradientId} x1="0.3" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor={theme.colors.electricCyan} />
            <Stop offset="1" stopColor={theme.colors.bmsRingTo} />
          </LinearGradient>
        </Defs>
        {sweep > 0 ? (
          <Path
            d={`M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`}
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={styles.centre} pointerEvents="none">
        <AppText variant="statValueLarge">{label}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
