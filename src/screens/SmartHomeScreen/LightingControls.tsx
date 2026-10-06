import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { clamp } from '../../utils/responsive';
import { lighting } from './SmartHomeScreen.data';

export interface LightingControlsProps {
  /** 0-1. */
  brightness: number;
  onBrightnessChange: (next: number) => void;
  presetId: string;
  onPresetChange: (id: string) => void;
  onCustomColorPress: () => void;
}

/*
 * Measured on the Smart Home reference: a brightness slider between two suns,
 * then five colour presets in a recessed pill beside the custom-colour ring.
 */
const SUN_SMALL = 12;
const SUN_LARGE = 15;
const SLIDER_HEIGHT = 20;
const TRACK_HEIGHT = 4;
const THUMB_SIZE = 11;
const VALUE_WIDTH = 27;
const ROW_GAP = 10;
const WELL_HEIGHT = 26;
const DOT_SIZE = 13;
const DOT_RING = 1;
const RING_SIZE = 16;
const RING_STROKE = 2.5;

/** Six arcs around a circle, one per hue, so the ring reads as a colour wheel. */
function arcPath(index: number, count: number, size: number, stroke: number) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const span = (2 * Math.PI) / count;
  const start = index * span - Math.PI / 2;
  const end = start + span + 0.02; // A hair of overlap hides the seams.
  const x1 = c + r * Math.cos(start);
  const y1 = c + r * Math.sin(start);
  const x2 = c + r * Math.cos(end);
  const y2 = c + r * Math.sin(end);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

/** The Lighting card's body: brightness, colour presets and the custom-colour ring. */
export function LightingControls({
  brightness,
  onBrightnessChange,
  presetId,
  onPresetChange,
  onCustomColorPress,
}: LightingControlsProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [trackWidth, setTrackWidth] = useState(0);
  const percent = Math.round(brightness * 100);

  // The slider's children ignore touches, so locationX is always across the track.
  const seek = (event: GestureResponderEvent) => {
    if (trackWidth > 0) {
      onBrightnessChange(clamp(event.nativeEvent.locationX / trackWidth, 0, 1));
    }
  };
  const step = (direction: 1 | -1) =>
    onBrightnessChange(clamp(brightness + direction * lighting.brightnessStep, 0, 1));

  return (
    <View>
      <View style={styles.sliderRow}>
        <Ionicons name="sunny-outline" size={SUN_SMALL} color={theme.colors.iconWarm} />
        <View
          style={styles.slider}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          // Holds the drag, so the page does not scroll out from under the thumb.
          onResponderTerminationRequest={() => false}
          onResponderGrant={seek}
          onResponderMove={seek}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Brightness"
          accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        >
          <View style={styles.track} pointerEvents="none">
            <LinearGradient
              colors={[theme.colors.sliderWarmFrom, theme.colors.sliderWarmTo]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.fill, { width: `${percent}%` }]}
            />
          </View>
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: trackWidth * brightness - THUMB_SIZE / 2 }]}
          />
        </View>
        <Ionicons name="sunny-outline" size={SUN_LARGE} color={theme.colors.iconWarm} />
        <AppText variant="statValue" align="right" style={styles.value}>
          {`${percent}%`}
        </AppText>
      </View>

      <View style={styles.presetRow}>
        <View style={styles.well} accessibilityRole="radiogroup">
          {lighting.presets.map((preset) => {
            const selected = preset.id === presetId;
            const color = theme.colors[preset.color];
            return (
              <Pressable
                key={preset.id}
                onPress={() => onPresetChange(preset.id)}
                hitSlop={4}
                accessibilityRole="radio"
                accessibilityLabel={preset.label}
                accessibilityState={{ selected }}
                style={[styles.dotRing, selected && styles.dotRingSelected]}
              >
                <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={onCustomColorPress}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Custom colour"
          style={({ pressed }) => [styles.ringWell, pressed && styles.pressed]}
        >
          <Svg width={RING_SIZE} height={RING_SIZE}>
            {lighting.ringHues.map((hue, index) => (
              <Path
                key={hue}
                d={arcPath(index, lighting.ringHues.length, RING_SIZE, RING_STROKE)}
                stroke={theme.colors[hue]}
                strokeWidth={RING_STROKE}
                fill="none"
              />
            ))}
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    sliderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.xs,
    },
    slider: {
      flex: 1,
      height: SLIDER_HEIGHT,
      justifyContent: 'center',
      marginHorizontal: 6,
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
      width: VALUE_WIDTH,
    },

    presetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: ROW_GAP,
    },
    well: {
      flex: 1,
      height: WELL_HEIGHT,
      borderRadius: WELL_HEIGHT / 2,
      backgroundColor: theme.colors.wellFill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingHorizontal: 3,
    },
    dotRing: {
      width: DOT_SIZE + DOT_RING * 2 + 2,
      height: DOT_SIZE + DOT_RING * 2 + 2,
      borderRadius: (DOT_SIZE + DOT_RING * 2 + 2) / 2,
      borderWidth: 1,
      borderColor: theme.colors.transparent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotRingSelected: {
      borderColor: theme.colors.white,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      shadowOpacity: 0.7,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },
    ringWell: {
      width: WELL_HEIGHT,
      height: WELL_HEIGHT,
      borderRadius: WELL_HEIGHT / 2,
      backgroundColor: theme.colors.wellFill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
