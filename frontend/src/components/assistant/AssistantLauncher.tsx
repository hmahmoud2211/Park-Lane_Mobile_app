import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { AssistantOrb } from './AssistantOrb';

export interface AssistantLauncherProps {
  onChat: () => void;
  onVoice: () => void;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const ORB_SIZE = 36;
const MIC_SIZE = 40;
/** Pulls the content out over the bar's own 24dp side padding. */
const BAR_INSET_CORRECTION = -14;

/**
 * The assistant's entry point in Home's glass bar: a living orb and a prompt
 * that open the chat, and a mic that drops straight into a voice call.
 */
export function AssistantLauncher({ onChat, onVoice, style }: AssistantLauncherProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduce = useReduceMotion();

  const [ring] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, ring]);

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={onChat}
        accessibilityRole="button"
        accessibilityLabel="Open Parklane Assistant"
        style={({ pressed }) => [styles.chat, pressed && styles.pressed]}
      >
        <AssistantOrb size={ORB_SIZE} mood="idle" compact />
        <View style={styles.text}>
          <AppText variant="tileTitle" numberOfLines={1}>
            Parklane Assistant
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={1} style={styles.caption}>
            Ask anything, by text or voice
          </AppText>
        </View>
      </Pressable>

      <View style={styles.micCell}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.micRing,
            {
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
            },
          ]}
        />
        <Pressable
          onPress={onVoice}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Talk to the assistant"
          style={({ pressed }) => [styles.mic, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={[theme.colors.ctaSky, theme.colors.ctaViolet, theme.colors.ctaPink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="mic" size={19} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: BAR_INSET_CORRECTION,
    },
    chat: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.xs,
    },
    text: {
      flex: 1,
      marginLeft: 10,
      marginRight: theme.spacing.sm,
    },
    caption: {
      marginTop: 1,
    },
    micCell: {
      width: MIC_SIZE,
      height: MIC_SIZE,
    },
    micRing: {
      ...StyleSheet.absoluteFill,
      borderRadius: MIC_SIZE / 2,
      backgroundColor: theme.colors.ctaViolet,
    },
    mic: {
      width: MIC_SIZE,
      height: MIC_SIZE,
      borderRadius: MIC_SIZE / 2,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
    },
    pressed: {
      opacity: 0.8,
      transform: [{ scale: 0.97 }],
    },
  });
}
