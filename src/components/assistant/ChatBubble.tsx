import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import type { ChatMessage } from '../../hooks/useAssistantChat';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { AssistantAvatar } from './AssistantAvatar';
import { InsightBadges } from './InsightBadges';
import type { IntentMeta } from './insights';
import { RichText, isRtlText } from './RichText';

export interface ChatBubbleProps {
  message: ChatMessage;
  /** New arrivals spring in and type out; history renders at rest. */
  animateIn: boolean;
  reduceMotion: boolean;
  onRetry?: (messageId: string) => void;
  onSignIn?: () => void;
  onOpenRoute?: (route: NonNullable<IntentMeta['route']>) => void;
}

const NATIVE = Platform.OS !== 'web';
const BUBBLE_RADIUS = 18;
const TAIL_RADIUS = 6;
/** The reveal finishes in about this many ticks, however long the answer. */
const REVEAL_TICKS = 40;
const REVEAL_TICK_MS = 18;

const timeOf = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Reveals `text` a few words per tick; returns the visible part and whether it is done. */
function useTypewriter(text: string, enabled: boolean) {
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [count, setCount] = useState(enabled ? 0 : words.length);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const step = Math.max(1, Math.ceil(words.length / REVEAL_TICKS));
    const timer = setInterval(() => {
      setCount((current) => {
        const next = Math.min(words.length, current + step);
        if (next >= words.length) {
          clearInterval(timer);
        }
        return next;
      });
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, words]);

  const done = !enabled || count >= words.length;
  return { visible: done ? text : words.slice(0, count).join(''), done };
}

function ChatBubbleView({ message, animateIn, reduceMotion, onRetry, onSignIn, onOpenRoute }: ChatBubbleProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isUser = message.role === 'user';
  const failed = message.status === 'failed';
  const animate = animateIn && !reduceMotion;

  const [appear] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) {
      return undefined;
    }
    const spring = Animated.spring(appear, {
      toValue: 1,
      damping: 16,
      stiffness: 190,
      mass: 0.9,
      useNativeDriver: NATIVE,
    });
    spring.start();
    return () => spring.stop();
  }, [animate, appear]);

  const { visible, done } = useTypewriter(message.text, animate && !isUser && !failed);

  const [footer] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!done || !animate) {
      return undefined;
    }
    const fade = Animated.timing(footer, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    fade.start();
    return () => fade.stop();
  }, [animate, done, footer]);

  const entry = {
    opacity: appear.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
    ],
    transformOrigin: isUser ? 'bottom right' : 'bottom left',
  } as const;

  if (isUser) {
    const rtl = isRtlText(message.text);
    return (
      <Animated.View style={[styles.row, styles.rowUser, entry]}>
        <LinearGradient
          colors={[theme.colors.ctaSky, theme.colors.ctaRoyal, theme.colors.ctaViolet]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.bubble, styles.userBubble]}
        >
          <AppText variant="chatBody" style={rtl ? styles.rtl : styles.ltr} selectable>
            {message.text}
          </AppText>
        </LinearGradient>
        <AppText variant="chatMeta" color={theme.colors.textMuted} style={styles.timeUser}>
          {timeOf(message.createdAt)}
        </AppText>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.row, entry]}>
      <View style={[styles.bubble, styles.assistantBubble, failed && styles.failedBubble]}>
        <View style={styles.header}>
          {failed ? (
            <Ionicons name="cloud-offline-outline" size={14} color={theme.colors.error} />
          ) : (
            <AssistantAvatar size={14} />
          )}
          <AppText variant="chatMeta" color={theme.colors.textSupport} style={styles.sender}>
            Parklane Assistant
          </AppText>
          <AppText variant="chatMeta" color={theme.colors.textMuted}>
            {timeOf(message.createdAt)}
          </AppText>
        </View>

        <RichText color={failed ? theme.colors.emergencyText : theme.colors.textPrimary}>{visible}</RichText>

        {failed && onRetry ? (
          <Pressable
            onPress={() => onRetry(message.id)}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <Ionicons name="refresh" size={13} color={theme.colors.textPrimary} />
            <AppText variant="chipLabel" style={styles.retryLabel}>
              Try again
            </AppText>
          </Pressable>
        ) : null}

        {!failed ? (
          <Animated.View style={{ opacity: footer }}>
            {done ? (
              <InsightBadges
                summary={message.summary}
                onSignIn={onSignIn}
                onOpenRoute={onOpenRoute}
                style={styles.badges}
              />
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      alignItems: 'flex-start',
      marginBottom: theme.spacing.md,
    },
    rowUser: {
      alignItems: 'flex-end',
    },
    bubble: {
      maxWidth: '86%',
      borderRadius: BUBBLE_RADIUS,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    userBubble: {
      borderBottomRightRadius: TAIL_RADIUS,
      ...theme.shadows.glow,
      shadowOpacity: 0.25,
    },
    assistantBubble: {
      borderBottomLeftRadius: TAIL_RADIUS,
      backgroundColor: theme.colors.bubbleFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
      minWidth: 180,
    },
    failedBubble: {
      backgroundColor: theme.colors.errorFill,
      borderColor: theme.colors.errorStroke,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    sender: {
      flex: 1,
      marginLeft: 6,
    },
    timeUser: {
      marginTop: 4,
      marginRight: 4,
    },
    ltr: {
      textAlign: 'left',
      writingDirection: 'ltr',
    },
    rtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    badges: {
      marginTop: 10,
    },
    retry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginTop: 10,
      height: 28,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.errorStroke,
      backgroundColor: theme.colors.emergencyFill,
    },
    retryLabel: {
      marginLeft: 6,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}

export const ChatBubble = memo(ChatBubbleView);
