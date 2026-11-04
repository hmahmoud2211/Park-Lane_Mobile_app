import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';

export interface SlideButtonProps {
  title: string;
  /** Fires once the knob is slid to the end, or on a screen reader's activate. */
  onComplete: () => void;
  /** Drawn in the knob's ring, e.g. the onboarding arrow. */
  icon: ReactNode;
  height?: number;
  /** Read out after the title; defaults to "Slide right to continue". */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Ring inset from the pill's edge, as on AppButton's leading icon. */
const KNOB_INSET = 6;
/** Fraction of the travel past which letting go completes the slide. */
const COMPLETE_AT = 0.7;
/** A flick this fast (dp/ms) completes from a shorter drag. */
const FLICK_VELOCITY = 0.8;
const FLICK_MIN_PROGRESS = 0.35;
/** The label is gone by this fraction of the travel. */
const LABEL_FADE_END = 0.4;
/** The trail's strongest, so it tints the glass rather than covering it. */
const TRAIL_OPACITY = 0.6;
const FINISH_MS = 160;
/** Long enough for the next screen to cover this one before the knob resets. */
const RESET_DELAY_MS = 650;
/** A tap bumps the knob this far right, hinting that it slides. */
const HINT_DISTANCE = 28;
const HINT_OUT_MS = 180;

const useNative = Platform.OS !== 'web';

/**
 * The onboarding CTA as a slide-to-start control: the same glass pill and
 * ringed arrow as AppButton's primary variant, but the arrow has to be dragged
 * to the far end. A cyan trail follows the knob and the label fades as it
 * goes; letting go early springs it back.
 *
 * Built on PanResponder rather than a gesture library, so it needs no native
 * module and runs in Expo Go and on the web alike.
 */
export function SlideButton({
  title,
  onComplete,
  icon,
  height = 56,
  accessibilityHint = 'Slide right to continue',
  style,
}: SlideButtonProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);
  const reduceMotion = useReduceMotion();

  // Lazy state rather than a ref: stable across renders, and readable during
  // render without tripping the rules of React.
  const [offset] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  // True from a completed slide until the knob resets; blocks a second drag.
  const [completed, setCompleted] = useState(false);

  const knobSize = height - KNOB_INSET * 2;
  const travel = Math.max(0, width - knobSize - KNOB_INSET * 2);

  // Settle back once the next screen has covered this one, so returning to
  // the screen never shows the knob at the far end.
  useEffect(() => {
    if (!completed) {
      return;
    }
    const timer = setTimeout(() => {
      offset.setValue(0);
      setCompleted(false);
    }, FINISH_MS + RESET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [completed, offset]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const springBack = useCallback(() => {
    Animated.spring(offset, {
      toValue: 0,
      bounciness: 6,
      speed: 14,
      useNativeDriver: useNative,
    }).start();
  }, [offset]);

  const finish = useCallback(() => {
    if (completed) {
      return;
    }
    setCompleted(true);
    Animated.timing(offset, {
      toValue: travel,
      duration: FINISH_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: useNative,
    }).start(({ finished }) => {
      if (finished) {
        onComplete();
      }
    });
  }, [completed, offset, travel, onComplete]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => travel > 0 && !completed,
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          travel > 0 && !completed && Math.abs(dx) > Math.abs(dy),
        // Keeps a parent scroll view or the stack's back swipe from stealing the drag.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          offset.stopAnimation();
        },
        onPanResponderMove: (_, { dx }) => {
          offset.setValue(Math.min(Math.max(dx, 0), travel));
        },
        onPanResponderRelease: (_, { dx, vx }) => {
          const progress = travel > 0 ? dx / travel : 0;
          if (
            progress >= COMPLETE_AT ||
            (vx > FLICK_VELOCITY && progress >= FLICK_MIN_PROGRESS)
          ) {
            finish();
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: springBack,
      }),
    [completed, travel, offset, finish, springBack],
  );

  // A tap does not start; the knob bumps right to show that it slides.
  const hint = useCallback(() => {
    if (completed || reduceMotion) {
      return;
    }
    Animated.sequence([
      Animated.timing(offset, {
        toValue: Math.min(HINT_DISTANCE, travel),
        duration: HINT_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
      Animated.spring(offset, {
        toValue: 0,
        bounciness: 10,
        speed: 12,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, [completed, offset, travel, reduceMotion]);

  // Screen readers cannot drag, so their activate gesture completes it outright.
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') {
        finish();
      }
    },
    [finish],
  );

  const safeTravel = Math.max(travel, 1);
  const labelOpacity = offset.interpolate({
    inputRange: [0, safeTravel * LABEL_FADE_END],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // The trail is the pill's width, slid in from the left so it ends at the knob.
  const trailShift = offset.interpolate({
    inputRange: [0, safeTravel],
    outputRange: [-width + knobSize + KNOB_INSET * 2, -width + knobSize + KNOB_INSET * 2 + safeTravel],
    extrapolate: 'clamp',
  });
  const trailOpacity = offset.interpolate({
    inputRange: [0, Math.min(HINT_DISTANCE, safeTravel)],
    outputRange: [0, TRAIL_OPACITY],
    extrapolate: 'clamp',
  });

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={onAccessibilityAction}
      style={[styles.shell, style]}
    >
      <GlassSurface radius={height / 2} style={styles.surface}>
        <Pressable onPress={hint} style={StyleSheet.absoluteFill} importantForAccessibility="no">
          <View style={styles.trailClip} pointerEvents="none">
            <Animated.View
              style={[
                styles.trail,
                { width, opacity: trailOpacity, transform: [{ translateX: trailShift }] },
              ]}
            >
              <LinearGradient
                colors={[theme.colors.glowOuter, theme.colors.glowInner]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>

          <Animated.View style={[styles.labelLayer, { opacity: labelOpacity }]} pointerEvents="none">
            <AppText variant="button">{title}</AppText>
          </Animated.View>
        </Pressable>

        <Animated.View
          {...panResponder.panHandlers}
          // A finger-sized grab area around the ring.
          hitSlop={{ top: KNOB_INSET, bottom: KNOB_INSET, left: KNOB_INSET, right: KNOB_INSET }}
          style={[styles.knob, { transform: [{ translateX: offset }] }]}
        >
          {icon}
        </Animated.View>
      </GlassSurface>
    </View>
  );
}

function createStyles(theme: AppTheme, height: number) {
  const knobSize = height - KNOB_INSET * 2;
  const radius = height / 2;

  return StyleSheet.create({
    shell: {
      height,
      borderRadius: radius,
      ...theme.shadows.glow,
    },
    surface: {
      flex: 1,
      justifyContent: 'center',
    },
    trailClip: {
      ...StyleSheet.absoluteFill,
      borderRadius: radius,
      overflow: 'hidden',
    },
    trail: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: radius,
      overflow: 'hidden',
    },
    labelLayer: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The same ring as AppButton's leading icon frame.
    knob: {
      position: 'absolute',
      left: KNOB_INSET,
      top: KNOB_INSET,
      width: knobSize,
      height: knobSize,
      borderRadius: knobSize / 2,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
