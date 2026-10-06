import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { clamp } from '../../utils/responsive';

export interface EnergyGaugeProps {
  /** e.g. "12.4 kWh". */
  value: string;
  caption: string;
  /** How full the arc is, 0-1. */
  fraction: number;
  /** e.g. "12%". */
  trend: string;
  /** True when usage is down, which draws the trend as a saving. */
  trendDown: boolean;
  trendCaption: string;
  size: number;
}

/*
 * Measured on the Smart Home reference: a 270° arc open at the bottom, lit
 * cyan from the bottom-left, with the day's figure inside and the change on
 * yesterday sitting in the opening.
 */
const STROKE = 9;
const GLOW_STROKE = 15;
const SWEEP = 270;
const START = -SWEEP / 2;
const LEAF_SIZE = 15;
const TREND_ICON_SIZE = 9;
/** How far the trend lines sit below the arc's bottom ends. */
const TREND_OVERLAP = 0.2;

/** A point on the gauge's circle, `degrees` clockwise from the top. */
function point(c: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: c + r * Math.sin(radians), y: c - r * Math.cos(radians) };
}

function arc(c: number, r: number, from: number, to: number) {
  const a = point(c, r, from);
  const b = point(c, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/** The Energy Usage panel's dial: today's consumption against the day's budget. */
export function EnergyGauge({
  value,
  caption,
  fraction,
  trend,
  trendDown,
  trendCaption,
  size,
}: EnergyGaugeProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, size), [theme, size]);

  const c = size / 2;
  const r = (size - GLOW_STROKE) / 2;
  const end = START + SWEEP * clamp(fraction, 0, 1);
  const trendColor = trendDown ? theme.colors.energyTrendDown : theme.colors.warning;

  return (
    <View
      style={styles.root}
      accessible
      accessibilityLabel={`${value} ${caption}, ${trendDown ? 'down' : 'up'} ${trend} ${trendCaption}`}
    >
      <Svg width={size} height={size}>
        <Path
          d={arc(c, r, START, START + SWEEP)}
          stroke={theme.colors.energyArcTrack}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
        {fraction > 0 ? (
          <>
            <Path
              d={arc(c, r, START, end)}
              stroke={theme.colors.energyArcGlow}
              strokeWidth={GLOW_STROKE}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d={arc(c, r, START, end)}
              stroke={theme.colors.energyArc}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
            />
          </>
        ) : null}
      </Svg>

      <View style={styles.centre} pointerEvents="none">
        <Ionicons name="leaf-outline" size={LEAF_SIZE} color={theme.colors.energyArc} />
        {/* My Unit's headline-figure role, e.g. its "EGP 8,500,000". */}
        <AppText variant="statValueLarge">{value}</AppText>
        <AppText variant="statLabel">{caption}</AppText>
      </View>

      <View style={styles.trend} pointerEvents="none">
        <View style={styles.trendRow}>
          <Ionicons name={trendDown ? 'caret-down' : 'caret-up'} size={TREND_ICON_SIZE} color={trendColor} />
          <AppText variant="statValueLarge" color={trendColor}>
            {trend}
          </AppText>
        </View>
        <AppText variant="statLabel">{trendCaption}</AppText>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme, size: number) {
  return StyleSheet.create({
    root: {
      width: size,
      // The trend lines hang a little below the arc.
      height: size * (1 + TREND_OVERLAP / 2),
    },
    centre: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: theme.spacing.xs,
    },
    trend: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
    },
    trendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
  });
}
