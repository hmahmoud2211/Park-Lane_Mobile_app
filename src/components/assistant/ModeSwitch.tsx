import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export type AssistantMode = 'chat' | 'voice';

export interface ModeSwitchProps {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const HEIGHT = 38;
const INSET = 3;

const OPTIONS: readonly { mode: AssistantMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: 'chat', label: 'Chat', icon: 'chatbubble-ellipses-outline' },
  { mode: 'voice', label: 'Voice', icon: 'mic-outline' },
];

/** Chat / Voice, with a lit pill that springs across to the chosen side. */
export function ModeSwitch({ mode, onChange, style }: ModeSwitchProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(mode === 'voice' ? 1 : 0));
  const segment = width > 0 ? (width - INSET * 2) / OPTIONS.length : 0;

  useEffect(() => {
    const spring = Animated.spring(position, {
      toValue: mode === 'voice' ? 1 : 0,
      damping: 18,
      stiffness: 240,
      useNativeDriver: NATIVE,
    });
    spring.start();
    return () => spring.stop();
  }, [mode, position]);

  return (
    <View
      style={[styles.track, style]}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {segment > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: segment,
              transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, segment] }) }],
            },
          ]}
        >
          <LinearGradient
            colors={[theme.colors.ctaSky, theme.colors.ctaViolet]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.thumbFill}
          />
        </Animated.View>
      ) : null}

      {OPTIONS.map((option) => {
        const selected = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            onPress={() => onChange(option.mode)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label} mode`}
            style={styles.option}
          >
            <Ionicons
              name={option.icon}
              size={15}
              color={selected ? theme.colors.textPrimary : theme.colors.textSecondary}
            />
            <AppText
              variant="chipLabel"
              color={selected ? theme.colors.textPrimary : theme.colors.textSecondary}
              style={styles.label}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    track: {
      height: HEIGHT,
      flexDirection: 'row',
      padding: INSET,
      borderRadius: HEIGHT / 2,
      backgroundColor: theme.colors.fieldFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.dividerSubtle,
    },
    thumb: {
      position: 'absolute',
      top: INSET,
      bottom: INSET,
      left: INSET,
      borderRadius: (HEIGHT - INSET * 2) / 2,
      ...theme.shadows.glow,
      shadowOpacity: 0.45,
      shadowRadius: 10,
    },
    thumbFill: {
      flex: 1,
      borderRadius: (HEIGHT - INSET * 2) / 2,
    },
    option: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      marginLeft: 6,
    },
  });
}
