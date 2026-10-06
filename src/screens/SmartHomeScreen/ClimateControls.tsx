import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { climate, type AcMode } from './SmartHomeScreen.data';

export interface ClimateControlsProps {
  temperature: number;
  onTemperatureChange: (next: number) => void;
  fanSpeed: number;
  onFanSpeedChange: (next: number) => void;
  mode: AcMode;
  onModeChange: (next: AcMode) => void;
}

/*
 * Measured on the Smart Home reference: minus and plus rings either side of
 * the set point, a rule, then the fan's speed bars and the mode picker.
 */
const STEP_BUTTON_SIZE = 26;
const STEP_ICON_SIZE = 15;
const STEP_STROKE = 1.25;
const RULE_TOP = 8;
const FAN_ROW_HEIGHT = 22;
const FAN_ICON_SIZE = 15;
const BAR_WIDTH = 5;
const BAR_HEIGHT = 8;
const BAR_GAP = 2;
const MODE_CHEVRON_SIZE = 9;

/** The AC card's body: set point, fan speed and mode. */
export function ClimateControls({
  temperature,
  onTemperatureChange,
  fanSpeed,
  onFanSpeedChange,
  mode,
  onModeChange,
}: ClimateControlsProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const atMin = temperature <= climate.minTemperature;
  const atMax = temperature >= climate.maxTemperature;
  // No dropdown is designed yet, so the picker steps through the modes.
  const nextMode = climate.modes[(climate.modes.indexOf(mode) + 1) % climate.modes.length];

  return (
    <View>
      <View style={styles.setPointRow}>
        <Pressable
          onPress={() => onTemperatureChange(temperature - 1)}
          disabled={atMin}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Lower temperature"
          accessibilityState={{ disabled: atMin }}
          style={({ pressed }) => [
            styles.stepButton,
            styles.stepCool,
            (pressed || atMin) && styles.pressed,
          ]}
        >
          <Ionicons name="remove" size={STEP_ICON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>

        <AppText
          variant="heroTitle"
          align="center"
          style={styles.setPoint}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${temperature} degrees`}
        >
          {`${temperature}°C`}
        </AppText>

        <Pressable
          onPress={() => onTemperatureChange(temperature + 1)}
          disabled={atMax}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Raise temperature"
          accessibilityState={{ disabled: atMax }}
          style={({ pressed }) => [
            styles.stepButton,
            styles.stepWarm,
            (pressed || atMax) && styles.pressed,
          ]}
        >
          <Ionicons name="add" size={STEP_ICON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.rule} />

      <View style={styles.fanRow}>
        <MaterialCommunityIcons name="fan" size={FAN_ICON_SIZE} color={theme.colors.textPrimary} />
        <View style={styles.bars}>
          {Array.from({ length: climate.fanLevels }, (_, index) => {
            const level = index + 1;
            const lit = level <= fanSpeed;
            return (
              <Pressable
                key={level}
                onPress={() => onFanSpeedChange(level)}
                hitSlop={{ top: 8, bottom: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Fan speed ${level}`}
                accessibilityState={{ selected: level === fanSpeed }}
                style={[styles.bar, lit ? styles.barLit : styles.barOff]}
              />
            );
          })}
        </View>
        <Pressable
          onPress={() => onModeChange(nextMode)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Mode, ${mode}`}
          accessibilityHint={`Switches to ${nextMode}`}
          style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
        >
          <AppText variant="statValue">{mode}</AppText>
          <Ionicons name="chevron-down" size={MODE_CHEVRON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    setPointRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.xs,
    },
    stepButton: {
      width: STEP_BUTTON_SIZE,
      height: STEP_BUTTON_SIZE,
      borderRadius: STEP_BUTTON_SIZE / 2,
      borderWidth: STEP_STROKE,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The minus ring is lit blue, the plus ring violet, as drawn.
    stepCool: {
      borderColor: theme.colors.neonBlue,
    },
    stepWarm: {
      borderColor: theme.colors.violet,
    },
    setPoint: {
      flex: 1,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
      marginTop: RULE_TOP,
    },
    fanRow: {
      height: FAN_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    bars: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: BAR_GAP,
      marginLeft: 7,
    },
    bar: {
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      borderRadius: 1.5,
    },
    barLit: {
      backgroundColor: theme.colors.electricCyan,
      shadowColor: theme.colors.electricCyan,
      shadowOpacity: 0.7,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 0 },
    },
    barOff: {
      backgroundColor: theme.colors.levelOff,
    },
    mode: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
