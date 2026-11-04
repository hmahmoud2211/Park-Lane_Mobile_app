import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface VoiceControlsProps {
  /** A call is connecting or connected: the main button hangs up. */
  inCall: boolean;
  muted: boolean;
  cameraOn: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const MAIN_SIZE = 72;
const SIDE_SIZE = 52;

/**
 * Camera, call and mute. The call button morphs from a glowing blue "start"
 * into a red hang-up, its handset turning as it goes.
 */
export function VoiceControls({
  inCall,
  muted,
  cameraOn,
  onStart,
  onEnd,
  onToggleMute,
  onToggleCamera,
  style,
}: VoiceControlsProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduce = useReduceMotion();

  const [morph] = useState(() => new Animated.Value(inCall ? 1 : 0));
  useEffect(() => {
    const spring = Animated.spring(morph, {
      toValue: inCall ? 1 : 0,
      damping: 15,
      stiffness: 180,
      useNativeDriver: NATIVE,
    });
    spring.start();
    return () => spring.stop();
  }, [inCall, morph]);

  // An inviting ring ripples out of the start button while it waits.
  const [invite] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (inCall || reduce) {
      invite.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(invite, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [inCall, invite, reduce]);

  const sideDisabled = !inCall;

  return (
    <View style={[styles.row, style]}>
      <SideButton
        icon={cameraOn ? 'camera' : 'camera-outline'}
        label={cameraOn ? 'Camera on' : 'Camera'}
        active={cameraOn}
        onPress={onToggleCamera}
        styles={styles}
        theme={theme}
      />

      <View style={styles.mainCell}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.invite,
            {
              opacity: invite.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: invite.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
            },
          ]}
        />
        <Pressable
          onPress={inCall ? onEnd : onStart}
          accessibilityRole="button"
          accessibilityLabel={inCall ? 'End voice chat' : 'Start voice chat'}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={[theme.colors.ctaSky, theme.colors.ctaViolet, theme.colors.ctaPink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: morph }]}>
            <LinearGradient
              colors={[theme.colors.hangUpFrom, theme.colors.hangUpTo]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={{
              transform: [{ rotate: morph.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] }) }],
            }}
          >
            <Ionicons name={inCall ? 'call' : 'mic'} size={28} color={theme.colors.textPrimary} />
          </Animated.View>
        </Pressable>
        <AppText variant="chatMeta" color={theme.colors.textSecondary} style={styles.label}>
          {inCall ? 'End' : 'Start'}
        </AppText>
      </View>

      <SideButton
        icon={muted ? 'mic-off' : 'mic-outline'}
        label={muted ? 'Unmute' : 'Mute'}
        active={muted}
        danger={muted}
        disabled={sideDisabled}
        onPress={onToggleMute}
        styles={styles}
        theme={theme}
      />
    </View>
  );
}

function SideButton({
  icon,
  label,
  active,
  danger = false,
  disabled = false,
  onPress,
  styles,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  theme: AppTheme;
}) {
  return (
    <View style={styles.sideCell}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked: active, disabled }}
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.side,
          active && (danger ? styles.sideDanger : styles.sideActive),
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={icon}
          size={22}
          color={active ? (danger ? theme.colors.error : theme.colors.accent) : theme.colors.textPrimary}
        />
      </Pressable>
      <AppText variant="chatMeta" color={theme.colors.textSecondary} style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'center',
      gap: 34,
    },
    mainCell: {
      alignItems: 'center',
    },
    sideCell: {
      alignItems: 'center',
      paddingTop: (MAIN_SIZE - SIDE_SIZE) / 2,
    },
    main: {
      width: MAIN_SIZE,
      height: MAIN_SIZE,
      borderRadius: MAIN_SIZE / 2,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
    },
    invite: {
      position: 'absolute',
      top: 0,
      width: MAIN_SIZE,
      height: MAIN_SIZE,
      borderRadius: MAIN_SIZE / 2,
      backgroundColor: theme.colors.ctaViolet,
    },
    side: {
      width: SIDE_SIZE,
      height: SIDE_SIZE,
      borderRadius: SIDE_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.border,
    },
    sideActive: {
      backgroundColor: theme.colors.infoFill,
      borderColor: theme.colors.accent,
    },
    sideDanger: {
      backgroundColor: theme.colors.errorFill,
      borderColor: theme.colors.errorStroke,
    },
    disabled: {
      opacity: 0.4,
    },
    label: {
      marginTop: 7,
    },
    pressed: {
      opacity: 0.8,
      transform: [{ scale: 0.94 }],
    },
  });
}
