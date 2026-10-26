import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { clamp } from '../../utils/responsive';
import { AppText } from '../common/AppText';

export interface LevelSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Values snap to it; screen-reader swipes move by it. */
  step: number;
  /** The figure beside the track, e.g. `40%` or `3000 K`. */
  format: (value: number) => string;
  /** Called once, when the drag ends, so a device gets one command per gesture. */
  onCommit: (value: number) => void;
  disabled?: boolean;
}

const SLIDER_HEIGHT = 28;
const TRACK_HEIGHT = 4;
const THUMB_SIZE = 14;
const VALUE_WIDTH = 64;

/**
 * A device level (brightness, position, speed, volume) on the Lighting card's
 * warm track. The thumb follows the finger locally and the value is sent
 * when it lifts; a new value from the device moves it when not dragging.
 */
export function LevelSlider({ label, value, min, max, step, format, onCommit, disabled = false }: LevelSliderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  // The committed value arrives (optimistically) in the same render the finger lifts in.
  const shown = dragging ?? value;

  const snap = (next: number) => clamp(Math.round(next / step) * step, min, max);
  const fraction = max > min ? (shown - min) / (max - min) : 0;

  // The slider's children ignore touches, so locationX is always across the track.
  const valueAt = (event: GestureResponderEvent) =>
    snap(min + clamp(event.nativeEvent.locationX / Math.max(trackWidth, 1), 0, 1) * (max - min));

  const move = (event: GestureResponderEvent) => setDragging(valueAt(event));
  const release = () => {
    if (dragging !== null && dragging !== value) {
      onCommit(dragging);
    }
    setDragging(null);
  };
  const nudge = (direction: 1 | -1) => onCommit(snap(shown + direction * step));

  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <AppText variant="statLabel" style={styles.label} numberOfLines={1}>
        {label}
      </AppText>
      <View
        style={styles.slider}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        // Holds the drag, so the page does not scroll out from under the thumb.
        onResponderTerminationRequest={() => false}
        onResponderGrant={move}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={release}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityValue={{ min, max, now: shown, text: format(shown) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View style={styles.track} pointerEvents="none">
          <LinearGradient
            colors={[theme.colors.sliderWarmFrom, theme.colors.sliderWarmTo]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]}
          />
        </View>
        <View pointerEvents="none" style={[styles.thumb, { left: trackWidth * fraction - THUMB_SIZE / 2 }]} />
      </View>
      <AppText variant="statValue" align="right" style={styles.value}>
        {format(shown)}
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      gap: theme.spacing.xs,
    },
    disabled: {
      opacity: 0.4,
    },
    label: {
      color: theme.colors.textSupport,
    },
    slider: {
      height: SLIDER_HEIGHT,
      justifyContent: 'center',
      marginHorizontal: THUMB_SIZE / 2,
    },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.levelOff,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: TRACK_HEIGHT / 2,
    },
    thumb: {
      position: 'absolute',
      top: (SLIDER_HEIGHT - THUMB_SIZE) / 2,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: theme.colors.white,
      shadowColor: theme.colors.white,
      shadowOpacity: 0.8,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
      elevation: 3,
    },
    value: {
      position: 'absolute',
      right: 0,
      top: 0,
      width: VALUE_WIDTH,
    },
  });
}
