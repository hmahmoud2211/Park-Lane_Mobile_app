import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { GlassSurface } from '../common/GlassSurface';
import { isRtlText } from './RichText';

export interface ChatComposerProps {
  onSend: (text: string) => boolean;
  /** Shown in place of send while the field is empty. */
  onVoice: () => void;
  /** A reply is on its way; sending waits for it. */
  busy: boolean;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const MIN_HEIGHT = 50;
const MAX_INPUT_HEIGHT = 112;
const BUTTON_SIZE = 38;
const MAX_LENGTH = 600;

/**
 * The message field. Its trailing button is the mic while the field is empty
 * and turns into send as soon as there is text, spinning across.
 */
export function ChatComposer({ onSend, onVoice, busy, style }: ChatComposerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const hasText = text.trim().length > 0;

  const [morph] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const spring = Animated.spring(morph, {
      toValue: hasText ? 1 : 0,
      damping: 14,
      stiffness: 220,
      useNativeDriver: NATIVE,
    });
    spring.start();
    return () => spring.stop();
  }, [hasText, morph]);

  const submit = useCallback(() => {
    if (!hasText || busy) {
      return;
    }
    if (onSend(text)) {
      setText('');
    }
  }, [busy, hasText, onSend, text]);

  // On the web, Enter sends and Shift+Enter adds a line, as in any chat app.
  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') {
        return;
      }
      const native = event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
      if (native.key === 'Enter' && !native.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const sendStyle = {
    opacity: morph,
    transform: [
      { scale: morph.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
      { rotate: morph.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) },
    ],
  };
  const micStyle = {
    opacity: morph.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ scale: morph.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }],
  };

  return (
    <GlassSurface radius={MIN_HEIGHT / 2} style={[styles.surface, style]}>
      {/* Wrapped so the field stacks above the blur layer on the web, where
          an absolutely positioned backdrop would otherwise paint over it. */}
      <View style={styles.field}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          onKeyPress={onKeyPress}
          placeholder="Ask about your unit, visitors, the building…"
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.accent}
          underlineColorAndroid={theme.colors.transparent}
          multiline
          maxLength={MAX_LENGTH}
          accessibilityLabel="Message the assistant"
          style={[styles.input, isRtlText(text) && styles.inputRtl]}
        />
      </View>

      <View style={styles.button}>
        <Animated.View style={[StyleSheet.absoluteFill, micStyle]} pointerEvents={hasText ? 'none' : 'auto'}>
          <Pressable
            onPress={onVoice}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Talk instead"
            style={({ pressed }) => [styles.mic, pressed && styles.pressed]}
          >
            <Ionicons name="mic-outline" size={19} color={theme.colors.textPrimary} />
          </Pressable>
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, sendStyle]} pointerEvents={hasText ? 'auto' : 'none'}>
          <Pressable
            onPress={submit}
            disabled={busy}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [styles.fill, pressed && styles.pressed]}
          >
            <LinearGradient
              colors={[theme.colors.ctaSky, theme.colors.ctaViolet, theme.colors.ctaPink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.send}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
              ) : (
                <Ionicons name="arrow-up" size={20} color={theme.colors.textPrimary} />
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingLeft: 18,
      paddingRight: 6,
      paddingVertical: 6,
    },
    field: {
      flex: 1,
      marginRight: 8,
    },
    input: {
      ...theme.typography.chatBody,
      color: theme.colors.textPrimary,
      maxHeight: MAX_INPUT_HEIGHT,
      minHeight: BUTTON_SIZE,
      paddingTop: Platform.OS === 'ios' ? 10 : 8,
      paddingBottom: Platform.OS === 'ios' ? 10 : 8,
      paddingHorizontal: 0,
      backgroundColor: theme.colors.transparent,
      textAlignVertical: 'center',
    },
    inputRtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    button: {
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
    },
    fill: {
      flex: 1,
    },
    mic: {
      flex: 1,
      borderRadius: BUTTON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.border,
    },
    send: {
      flex: 1,
      borderRadius: BUTTON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.75,
      transform: [{ scale: 0.94 }],
    },
  });
}

/** Re-exported so the screen can size its scroll padding. */
export const COMPOSER_MIN_HEIGHT = MIN_HEIGHT;
