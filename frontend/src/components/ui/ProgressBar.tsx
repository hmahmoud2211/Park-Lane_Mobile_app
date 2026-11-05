import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface ProgressBarProps {
  /** Completed fraction, 0-1; clamped. */
  progress: number;
  height?: number;
  /** Fill stops, left to right; defaults to the neon cyan-to-magenta sweep. */
  colors?: readonly [string, string, ...string[]];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Glowing pill gauge, first used for the My Unit payment progress. The fill is
 * a gradient clipped to the completed width, so the colours stay put rather
 * than stretching as progress changes.
 */
export function ProgressBar({
  progress,
  height = 11,
  colors,
  accessibilityLabel,
  style,
}: ProgressBarProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);

  const clamped = Math.min(Math.max(progress, 0), 1);
  const stops = colors ?? [
    theme.colors.electricCyan,
    theme.colors.neonBlue,
    theme.colors.violet,
    theme.colors.magenta,
  ];

  return (
    <View
      style={[styles.track, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      {/* The glow lives on an unclipped wrapper; iOS drops shadows on views
          that clip their children. */}
      <View style={[styles.fill, { width: `${clamped * 100}%` }]}>
        <View style={styles.fillClip}>
          <LinearGradient
            colors={[...stops]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme, height: number) {
  return StyleSheet.create({
    track: {
      height,
      borderRadius: height / 2,
      backgroundColor: theme.colors.midnightBlue,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
    },
    fill: {
      height: '100%',
      borderRadius: height / 2,
      // Gives the shadow an opaque shape to cast from; hidden by the gradient.
      backgroundColor: theme.colors.violet,
      shadowColor: theme.colors.violet,
      shadowOpacity: 0.8,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    fillClip: {
      flex: 1,
      borderRadius: height / 2,
      overflow: 'hidden',
    },
  });
}
