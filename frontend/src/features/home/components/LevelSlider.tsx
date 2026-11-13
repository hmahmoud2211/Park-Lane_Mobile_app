import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { AppTheme } from '../../../types/theme.types';
import { clamp } from '../../../utils/responsive';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppText } from '../../../components/common/AppText';

export interface LevelSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Values snap to it while dragging. */
  step: number;
  /** How far the − and + buttons (and screen-reader swipes) move it; defaults to `step`. */
  nudge?: number;
  /** The figure beside the label, e.g. `40%` or `Warm white · 3000 K`. */
  format: (value: number) => string;
  /** Called once, when the drag ends or a button is pressed, so a device gets one command per gesture. */
  onCommit: (value: number) => void;
  /** Not possible now (the device is not responding): dimmed. */
  disabled?: boolean;
  /** Another command is on its way: ignores touches without dimming. */
  waiting?: boolean;
  /** This slider's command is on its way. */
  busy?: boolean;
}

/** The whole row is the touch target, so it is never shorter than 48dp. */
const TOUCH_HEIGHT = 48;
const TRACK_HEIGHT = 8;
const THUMB_SIZE = 26;
const NUDGE_ICON_SIZE = 22;

/**
 * A device level (brightness, position, speed, volume) on the Lighting card's warm track,
 * with − and + either side for anyone who finds dragging hard. The thumb follows the finger
 * locally and the value is sent when it lifts; a new value from the device moves it when
 * not dragging.
 */
export function LevelSlider({ label, value, min, max, step, nudge, format, onCommit, disabled = false, waiting = false, busy = false }: LevelSliderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  // The committed value arrives (optimistically) in the same render the finger lifts in.
  const shown = dragging ?? value;
  const inert = disabled || waiting || busy;
  const by = nudge ?? step;

  const snap = (next: number) => clamp(Math.round(next / step) * step, min, max);
  const fraction = max > min ? clamp((shown - min) / (max - min), 0, 1) : 0;

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
  const nudgeBy = (direction: 1 | -1) => {
    const next = clamp(Math.round((shown + direction * by) / step) * step, min, max);
    if (next !== shown) onCommit(next);
  };

  const nudgeButton = (direction: 1 | -1) => {
    const atEnd = direction > 0 ? shown >= max : shown <= min;
    return (
      <Pressable
        onPress={() => nudgeBy(direction)}
        disabled={inert || atEnd}
        accessibilityRole="button"
        accessibilityLabel={`${direction > 0 ? 'More' : 'Less'} ${label.toLowerCase()}`}
        accessibilityState={{ disabled: disabled || waiting || atEnd, busy }}
        style={({ pressed }) => [styles.nudge, pressed && styles.pressed, atEnd && !disabled && styles.dim]}
      >
        <AppIcon set="material" name={direction > 0 ? 'plus' : 'minus'} size={NUDGE_ICON_SIZE} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, disabled && styles.dim]}>
      <View style={styles.header}>
        <AppText variant="controlCaption" color={theme.colors.textSupport} style={styles.label}>
          {label}
        </AppText>
        <View style={styles.valueRow}>
          {busy ? <ActivityIndicator size="small" color={theme.colors.textPrimary} /> : null}
          <AppText variant="controlLabel">{format(shown)}</AppText>
        </View>
      </View>
      <View style={styles.trackRow}>
        {nudgeButton(-1)}
        <View
          style={styles.slider}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => !inert}
          onMoveShouldSetResponder={() => !inert}
          // Holds the drag, so the page does not scroll out from under the thumb.
          onResponderTerminationRequest={() => false}
          onResponderGrant={move}
          onResponderMove={move}
          onResponderRelease={release}
          onResponderTerminate={release}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityState={{ disabled: disabled || waiting, busy }}
          accessibilityValue={{ min, max, now: shown, text: format(shown) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (!inert) nudgeBy(event.nativeEvent.actionName === 'increment' ? 1 : -1);
          }}
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
        {nudgeButton(1)}
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const target = theme.layout.deviceControl.minTarget;
  return StyleSheet.create({
    root: {
      gap: theme.spacing.xs,
    },
    dim: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.7,
    },
    // Wraps instead of overlapping when large text makes the label and value wide.
    header: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: theme.spacing.sm,
    },
    label: {
      flexShrink: 1,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    trackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    nudge: {
      width: target,
      height: target,
      borderRadius: target / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slider: {
      flex: 1,
      height: TOUCH_HEIGHT,
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
      top: (TOUCH_HEIGHT - THUMB_SIZE) / 2,
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
  });
}
