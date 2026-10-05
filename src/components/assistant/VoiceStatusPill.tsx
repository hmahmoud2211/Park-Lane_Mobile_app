import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { VoicePhase } from '../../hooks/useVoiceSession';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface VoiceStatusPillProps {
  phase: VoicePhase;
  queryFn: string | null;
  muted: boolean;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';

export function statusLabel(phase: VoicePhase, queryFn: string | null, muted: boolean): string {
  switch (phase) {
    case 'idle':
      return 'Ready';
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return muted ? 'Muted' : 'Listening';
    case 'hearing':
      return 'Hearing you';
    case 'thinking':
      return 'Thinking';
    case 'searching':
      return queryFn === 'query_resident_services' ? 'Checking your records' : 'Checking building data';
    case 'looking':
      return 'Looking';
    case 'speaking':
      return 'Speaking';
    case 'error':
      return 'Disconnected';
  }
}

/** A glass pill naming what the session is doing, with a pulsing status light. */
export function VoiceStatusPill({ phase, queryFn, muted, style }: VoiceStatusPillProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduce = useReduceMotion();
  const label = statusLabel(phase, queryFn, muted);
  const live = phase !== 'idle' && phase !== 'error';

  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!live || reduce) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse, reduce]);

  // The label slides in afresh each time it changes.
  const [swap] = useState(() => new Animated.Value(1));
  useEffect(() => {
    swap.setValue(0);
    const animation = Animated.timing(swap, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [label, swap]);

  const dotColor = colorFor(theme, phase, muted);

  return (
    <View
      style={[styles.pill, style]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Assistant status: ${label}`}
    >
      <View style={styles.dotBox}>
        <Animated.View
          style={[
            styles.dotRing,
            {
              backgroundColor: dotColor,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            },
          ]}
        />
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      </View>
      <Animated.View
        style={{
          opacity: swap,
          transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        }}
      >
        <AppText variant="voiceStatus" color={theme.colors.textPrimary}>
          {label}
        </AppText>
      </Animated.View>
    </View>
  );
}

function colorFor(theme: AppTheme, phase: VoicePhase, muted: boolean): string {
  switch (phase) {
    case 'listening':
      return muted ? theme.colors.warning : theme.colors.success;
    case 'hearing':
      return theme.colors.success;
    case 'speaking':
      return theme.colors.magenta;
    case 'thinking':
    case 'searching':
    case 'looking':
      return theme.colors.accent;
    case 'connecting':
      return theme.colors.warning;
    case 'error':
      return theme.colors.error;
    case 'idle':
    default:
      return theme.colors.textMuted;
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      height: 30,
      paddingHorizontal: 14,
      borderRadius: 15,
      backgroundColor: theme.colors.fieldFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.dividerSubtle,
    },
    dotBox: {
      width: 8,
      height: 8,
      marginRight: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dotRing: {
      position: 'absolute',
      width: 8,
      height: 8,
      borderRadius: 4,
    },
  });
}
