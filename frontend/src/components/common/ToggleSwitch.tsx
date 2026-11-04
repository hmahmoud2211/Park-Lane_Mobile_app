import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';

export interface ToggleSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** What the switch controls, e.g. "Lighting". */
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Smart Home design (assets/Screens/screen9.png, screen10.png): a
 * bright blue pill with a glowing white knob when on. Drawn 23 x 12dp; a
 * touch larger here so the knob reads, with hitSlop making up the target.
 */
const WIDTH = 27;
const HEIGHT = 15;
const KNOB_INSET = 2;
const KNOB_SIZE = HEIGHT - KNOB_INSET * 2;
const TRAVEL = WIDTH - KNOB_SIZE - KNOB_INSET * 2;
const DURATION = 160;
const NATIVE = Platform.OS !== 'web';

/** The on/off switch of the Smart Home cards and rows. */
export function ToggleSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  style,
}: ToggleSwitchProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduceMotion = useReduceMotion();
  const [position] = useState(() => new Animated.Value(value ? 1 : 0));
  const knobX = useMemo(
    () => position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }),
    [position],
  );

  useEffect(() => {
    if (reduceMotion) {
      position.setValue(value ? 1 : 0);
      return;
    }
    const animation = Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: DURATION,
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [position, reduceMotion, value]);

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={12}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [styles.track, style, (pressed || disabled) && styles.dimmed]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: position }]} pointerEvents="none">
        <LinearGradient
          colors={[theme.colors.toggleOnFrom, theme.colors.toggleOnTo]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.knob,
          { transform: [{ translateX: knobX }] },
        ]}
        pointerEvents="none"
      >
        <View style={[styles.knobFace, !value && styles.knobOff]} />
      </Animated.View>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    track: {
      width: WIDTH,
      height: HEIGHT,
      borderRadius: HEIGHT / 2,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      justifyContent: 'center',
    },
    knob: {
      position: 'absolute',
      left: KNOB_INSET,
      width: KNOB_SIZE,
      height: KNOB_SIZE,
    },
    knobFace: {
      flex: 1,
      borderRadius: KNOB_SIZE / 2,
      backgroundColor: theme.colors.white,
      shadowColor: theme.colors.white,
      shadowOpacity: 0.7,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },
    knobOff: {
      backgroundColor: theme.colors.textSecondary,
      shadowOpacity: 0,
    },
    dimmed: {
      opacity: 0.6,
    },
  });
}
