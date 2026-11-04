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
  type StyleProp,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { NeonPanel } from '../ui/NeonPanel';
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
/*
 * After the Assistant design (assets/Screens/screen14.png), more compact: a
 * 48dp neon pill, a cyan sparkle 14dp in, and a 34dp mic in a blue-to-violet
 * ring, 7dp from the right edge.
 */
const MIN_HEIGHT = 48;
const MAX_INPUT_HEIGHT = 112;
const BUTTON_SIZE = 34;
const BUTTON_INSET = 7;
const SPARKLE_SIZE = 19;
const MIC_ICON_SIZE = 18;
const MIC_RING = 1.5;
const MAX_LENGTH = 600;
/**
 * react-native-web's textarea defaults to two rows, which sets the placeholder
 * above the mic; one row lines them up. `rows` is web-only (React Native's
 * types omit it, and native sizes the field to its content), so it is spread
 * in rather than passed as a typed prop.
 */
const WEB_SINGLE_ROW: object = Platform.OS === 'web' ? { rows: 1 } : {};

/**
 * The message field. Its trailing button is the mic while the field is empty
 * and turns into send as soon as there is text, spinning across.
 */
export function ChatComposer({ onSend, onVoice, busy, style }: ChatComposerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [text, setText] = useState('');
  const input = useRef<TextInputInstance>(null);
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
    (event: TextInputKeyPressEvent) => {
      if (Platform.OS !== 'web') {
        return;
      }
      const native = event.nativeEvent as TextInputKeyPressEvent['nativeEvent'] & { shiftKey?: boolean };
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
    <NeonPanel style={[styles.surface, style]} radius={MIN_HEIGHT / 2}>
      <View style={styles.sparkle} pointerEvents="none">
        <Ionicons name="sparkles-outline" size={SPARKLE_SIZE} color={theme.colors.accent} />
      </View>
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
          {...WEB_SINGLE_ROW}
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
            style={({ pressed }) => [styles.fill, styles.micGlow, pressed && styles.pressed]}
          >
            {/* The ring is the gradient showing around an inset fill. */}
            <LinearGradient
              colors={[theme.colors.ctaSky, theme.colors.ctaViolet]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.micRing}
            >
              <LinearGradient
                colors={[theme.colors.actionBlueVia, theme.colors.actionVioletVia]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.micFill}
              >
                <Ionicons name="mic-outline" size={MIC_ICON_SIZE} color={theme.colors.textPrimary} />
              </LinearGradient>
            </LinearGradient>
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
                <Ionicons name="arrow-up" size={MIC_ICON_SIZE} color={theme.colors.textPrimary} />
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingLeft: 14,
      paddingRight: BUTTON_INSET,
      paddingVertical: BUTTON_INSET,
    },
    // As tall as the button, so the glyph stays on the first line's centre.
    sparkle: {
      height: BUTTON_SIZE,
      justifyContent: 'center',
      marginRight: 10,
    },
    field: {
      flex: 1,
      marginRight: 8,
    },
    input: {
      ...theme.typography.bodySmall,
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
    micGlow: {
      borderRadius: BUTTON_SIZE / 2,
      ...theme.shadows.glow,
      shadowColor: theme.colors.violet,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 8,
      shadowOpacity: 0.6,
    },
    micRing: {
      flex: 1,
      borderRadius: BUTTON_SIZE / 2,
      padding: MIC_RING,
    },
    micFill: {
      flex: 1,
      borderRadius: BUTTON_SIZE / 2 - MIC_RING,
      alignItems: 'center',
      justifyContent: 'center',
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
