import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useId, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';

/**
 * What the orb is showing. `hearing` is the resident talking and `speaking`
 * the assistant; both make it pulse with `level`.
 */
export type OrbMood = 'idle' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'error';

export interface AssistantOrbProps {
  /** Diameter of the core. The halo and ripples spread past it. */
  size: number;
  mood: OrbMood;
  /** Loudness 0..1 of whoever is talking (see useVoiceSession). */
  level?: Animated.Value;
  /** Core only: no halo, ripples or glyphs, for small placements. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
/** Room around the core for the halo and the outermost ripple. */
const HALO_SPAN = 1.75;
const RIPPLE_COUNT = 3;
/** Per-bar reach and wobble phase, so the equaliser never moves in lockstep. */
const BAR_GAIN = [0.55, 0.85, 1, 0.8, 0.6] as const;
const BAR_PHASE = [0, 0.37, 0.71, 0.18, 0.53] as const;

const ZERO = new Animated.Value(0);

interface MoodTargets {
  listen: number;
  speak: number;
  error: number;
  ripples: number;
  spinner: number;
  orbit: number;
  /** How strongly `level` swells the core. */
  pulse: number;
}

function targetsFor(mood: OrbMood): MoodTargets {
  switch (mood) {
    case 'connecting':
      return { listen: 0.55, speak: 0, error: 0, ripples: 0, spinner: 1, orbit: 0, pulse: 0 };
    case 'listening':
      return { listen: 1, speak: 0, error: 0, ripples: 0.55, spinner: 0, orbit: 0, pulse: 0.5 };
    case 'hearing':
      return { listen: 1, speak: 0, error: 0, ripples: 1, spinner: 0, orbit: 0, pulse: 1 };
    case 'thinking':
      return { listen: 0.6, speak: 0.45, error: 0, ripples: 0, spinner: 0.8, orbit: 1, pulse: 0 };
    case 'speaking':
      return { listen: 0.2, speak: 1, error: 0, ripples: 1, spinner: 0, orbit: 0, pulse: 1 };
    case 'error':
      return { listen: 0, speak: 0, error: 1, ripples: 0, spinner: 0, orbit: 0, pulse: 0 };
    case 'idle':
    default:
      return { listen: 0.7, speak: 0.25, error: 0, ripples: 0, spinner: 0, orbit: 0, pulse: 0 };
  }
}

const EASE_BREATH = Easing.inOut(Easing.sin);

/**
 * A looping 0 -> 1 driver. `pingPong` eases back down instead of jumping to
 * 0, for values that are not periodic (breathing). `reduce` holds it at 0.5.
 */
function useLoop(duration: number, reduce: boolean, pingPong = false) {
  const [value] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    if (reduce) {
      value.setValue(0.5);
      return undefined;
    }
    value.setValue(0);
    const loop = Animated.loop(
      pingPong
        ? Animated.sequence([
            Animated.timing(value, { toValue: 1, duration: duration / 2, easing: EASE_BREATH, useNativeDriver: NATIVE }),
            Animated.timing(value, { toValue: 0, duration: duration / 2, easing: EASE_BREATH, useNativeDriver: NATIVE }),
          ])
        : Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, reduce, pingPong]);
  return value;
}

/**
 * The assistant's presence: a glowing core of the palette's four glows that
 * drifts slowly, with a halo that turns cyan when listening and magenta when
 * speaking. Ripples and an equaliser follow the live voice level, an orbit and
 * a spinner show work in progress, and a red wash marks a failure.
 *
 * Every layer animates only opacity and transforms, on the native driver.
 */
function AssistantOrbView({ size, mood, level = ZERO, compact = false, style }: AssistantOrbProps) {
  const theme = useAppTheme();
  const reduce = useReduceMotion();
  const styles = useMemo(() => createStyles(theme, size, compact), [theme, size, compact]);
  const rawId = useId();
  const id = useMemo(() => {
    const base = rawId.replace(/:/g, '');
    return (name: string) => `orb-${name}-${base}`;
  }, [rawId]);

  const breath = useLoop(3600, reduce, true);
  const spinA = useLoop(9000, reduce);
  const spinB = useLoop(13000, reduce);
  const ripple = useLoop(2600, reduce || compact);
  const spinner = useLoop(1100, reduce || compact);
  const orbit = useLoop(2400, reduce || compact);
  const wobble = useLoop(900, reduce || compact);

  const [mix] = useState(() => {
    const start = targetsFor(mood);
    return {
      listen: new Animated.Value(start.listen),
      speak: new Animated.Value(start.speak),
      error: new Animated.Value(start.error),
      ripples: new Animated.Value(start.ripples),
      spinner: new Animated.Value(start.spinner),
      orbit: new Animated.Value(start.orbit),
      pulse: new Animated.Value(start.pulse),
    };
  });

  // Cross-fade every layer to the new mood together.
  useEffect(() => {
    const targets = targetsFor(mood);
    const fade = Animated.parallel(
      (Object.keys(targets) as (keyof MoodTargets)[]).map((key) =>
        Animated.timing(mix[key], {
          toValue: targets[key],
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
      ),
    );
    fade.start();
    return () => fade.stop();
  }, [mood, mix]);

  // Built once per driver set, so a re-render never rebuilds the native graph.
  const motion = useMemo(() => {
    const swell = Animated.multiply(level, mix.pulse);
    const turn = (driver: Animated.Value, reverse = false) =>
      driver.interpolate({ inputRange: [0, 1], outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'] });
    return {
      // Breathing, plus a swell with the voice.
      coreScale: Animated.add(
        breath.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1.035] }),
        Animated.multiply(swell, 0.16),
      ),
      haloScale: Animated.add(
        breath.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }),
        Animated.multiply(swell, 0.32),
      ),
      rotateA: turn(spinA),
      rotateB: turn(spinB, true),
      spin: turn(spinner),
      orbit: turn(orbit),
      ripples: Array.from({ length: RIPPLE_COUNT }, (_, index) => {
        const progress = Animated.modulo(Animated.add(ripple, index / RIPPLE_COUNT), 1);
        return {
          opacity: Animated.multiply(
            mix.ripples,
            progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
          ),
          scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, HALO_SPAN * 0.92] }),
        };
      }),
      bars: BAR_GAIN.map((gain, index) => {
        const swing = Animated.modulo(Animated.add(wobble, BAR_PHASE[index]), 1).interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.55, 1, 0.55],
        });
        return Animated.add(0.16, Animated.multiply(Animated.multiply(level, swing), gain * 0.84));
      }),
    };
  }, [breath, level, mix, orbit, ripple, spinA, spinB, spinner, wobble]);

  const glyph = mood === 'idle' ? 'mic' : mood === 'error' ? 'alert' : null;
  const showBars = !compact && (mood === 'listening' || mood === 'hearing' || mood === 'speaking');

  return (
    <View style={[styles.box, style]} pointerEvents="none">
      {compact ? null : (
        <>
          <Animated.View
            style={[styles.halo, { opacity: mix.listen, transform: [{ scale: motion.haloScale }] }]}
          >
            <Glow id={id('listen')} size={size * HALO_SPAN} color={theme.colors.orbHaloListen} edge={theme.colors.orbHaloEdge} />
          </Animated.View>
          <Animated.View
            style={[styles.halo, { opacity: mix.speak, transform: [{ scale: motion.haloScale }] }]}
          >
            <Glow id={id('speak')} size={size * HALO_SPAN} color={theme.colors.orbHaloSpeak} edge={theme.colors.orbHaloEdge} />
          </Animated.View>

          {motion.ripples.map((ring, index) => (
            <Animated.View
              key={index}
              style={[
                styles.ripple,
                {
                  borderColor: mood === 'speaking' ? theme.colors.orbRingSpeak : theme.colors.orbRing,
                  opacity: ring.opacity,
                  transform: [{ scale: ring.scale }],
                },
              ]}
            />
          ))}

          <Animated.View
            style={[
              styles.spinner,
              {
                opacity: mix.spinner,
                transform: [{ rotate: motion.spin }],
              },
            ]}
          >
            <Svg width={size * 1.22} height={size * 1.22}>
              <Circle
                cx={size * 0.61}
                cy={size * 0.61}
                r={size * 0.58}
                stroke={theme.colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={`${size * 0.9} ${size * 3}`}
                fill="none"
              />
            </Svg>
          </Animated.View>
        </>
      )}

      <Animated.View style={[styles.core, { transform: [{ scale: motion.coreScale }] }]}>
        <View style={styles.clip}>
          <LinearGradient
            colors={[theme.colors.neonBlue, theme.colors.violet, theme.colors.midnightBlue]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: motion.rotateA }] }]}>
            <View style={styles.blobA}>
              <Glow id={id('a')} size={size * 0.95} color={theme.colors.orbBlobCyan} edge={theme.colors.orbHaloEdge} />
            </View>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: motion.rotateB }] }]}>
            <View style={styles.blobB}>
              <Glow id={id('b')} size={size * 0.9} color={theme.colors.orbBlobMagenta} edge={theme.colors.orbHaloEdge} />
            </View>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: mix.error }]}>
            <LinearGradient
              colors={[theme.colors.hangUpFrom, theme.colors.hangUpTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <View style={styles.gloss}>
            <Glow id={id('gloss')} size={size * 0.7} color={theme.colors.orbGloss} edge={theme.colors.orbGlossEdge} />
          </View>
        </View>
        <View style={styles.rim} />

        {glyph ? (
          <Ionicons name={glyph} size={size * 0.3} color={theme.colors.textPrimary} style={styles.glyph} />
        ) : null}

        {showBars ? (
          <View style={styles.bars}>
            {motion.bars.map((scaleY, index) => (
              <Animated.View key={index} style={[styles.bar, { transform: [{ scaleY }] }]} />
            ))}
          </View>
        ) : null}
      </Animated.View>

      {compact ? null : (
        <Animated.View
          style={[
            styles.orbit,
            {
              opacity: mix.orbit,
              transform: [{ rotate: motion.orbit }],
            },
          ]}
        >
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={[
                styles.orbitDot,
                {
                  opacity: 1 - index * 0.28,
                  transform: [
                    { rotate: `${index * 22}deg` },
                    { translateY: -size * 0.66 },
                  ],
                },
              ]}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

/** A soft radial glow: `color` at the centre fading to `edge`. */
function Glow({ id, size, color, edge }: { id: string; size: number; color: string; edge: string }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} />
          <Stop offset="0.55" stopColor={color} stopOpacity={0.45} />
          <Stop offset="1" stopColor={edge} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function createStyles(theme: AppTheme, size: number, compact: boolean) {
  const box = compact ? size : size * HALO_SPAN;
  const centred = (diameter: number): ViewStyle => ({
    position: 'absolute',
    width: diameter,
    height: diameter,
    left: (box - diameter) / 2,
    top: (box - diameter) / 2,
  });
  const barWidth = Math.max(2, size * 0.045);
  const barHeight = size * 0.34;

  return StyleSheet.create({
    box: {
      width: box,
      height: box,
    },
    halo: centred(size * HALO_SPAN),
    ripple: {
      ...centred(size),
      borderRadius: size / 2,
      borderWidth: 1.5,
    },
    spinner: centred(size * 1.22),
    core: {
      ...centred(size),
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      ...(compact ? null : theme.shadows.glow),
    },
    clip: {
      ...StyleSheet.absoluteFill,
      borderRadius: size / 2,
      overflow: 'hidden',
    },
    blobA: {
      position: 'absolute',
      left: -size * 0.2,
      top: -size * 0.22,
    },
    blobB: {
      position: 'absolute',
      right: -size * 0.24,
      bottom: -size * 0.2,
    },
    gloss: {
      position: 'absolute',
      left: size * 0.06,
      top: size * 0.02,
    },
    rim: {
      ...StyleSheet.absoluteFill,
      borderRadius: size / 2,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.frameStroke,
    },
    glyph: {
      opacity: 0.92,
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'center',
      height: barHeight,
      gap: barWidth * 0.9,
    },
    bar: {
      width: barWidth,
      height: barHeight,
      borderRadius: barWidth / 2,
      backgroundColor: theme.colors.textPrimary,
      opacity: 0.92,
    },
    orbit: centred(size),
    orbitDot: {
      position: 'absolute',
      left: size / 2 - 3,
      top: size / 2 - 3,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
  });
}

export const AssistantOrb = memo(AssistantOrbView);

/** Maps a voice session phase to the orb's mood. */
export function moodForPhase(
  phase: 'idle' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'searching' | 'looking' | 'speaking' | 'error',
): OrbMood {
  return phase === 'searching' || phase === 'looking' ? 'thinking' : phase;
}
