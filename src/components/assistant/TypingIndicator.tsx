import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { AssistantAvatar } from './AssistantAvatar';

const NATIVE = Platform.OS !== 'web';
const DOT_COUNT = 3;
const BOUNCE_MS = 340;
const STAGGER_MS = 140;
/** Answers take 2-5s; the hint moves on so a long wait still feels alive. */
const HINTS = ['Thinking', 'Checking the records', 'Putting it together', 'Almost there'];
const HINT_MS = 2200;

/** The assistant's "typing" bubble: three bouncing dots and a changing hint. */
export function TypingIndicator() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduce = useReduceMotion();
  const [dots] = useState(() => Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)));
  const [appear] = useState(() => new Animated.Value(0));
  const [hint, setHint] = useState(0);
  const [hintFade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const entry = Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    entry.start();
    return () => entry.stop();
  }, [appear]);

  useEffect(() => {
    if (reduce) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.stagger(
        STAGGER_MS,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: BOUNCE_MS, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
            Animated.timing(dot, { toValue: 0, duration: BOUNCE_MS, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots, reduce]);

  useEffect(() => {
    const timer = setInterval(() => {
      Animated.timing(hintFade, { toValue: 0, duration: 180, useNativeDriver: NATIVE }).start(() => {
        setHint((index) => Math.min(index + 1, HINTS.length - 1));
        Animated.timing(hintFade, { toValue: 1, duration: 220, useNativeDriver: NATIVE }).start();
      });
    }, HINT_MS);
    return () => clearInterval(timer);
  }, [hintFade]);

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="The assistant is answering"
    >
      <AssistantAvatar size={14} />
      <View style={styles.dots}>
        {dots.map((dot, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
              },
            ]}
          />
        ))}
      </View>
      <Animated.View style={{ opacity: hintFade }}>
        <AppText variant="chatMeta" color={theme.colors.textSupport}>
          {`${HINTS[hint]}…`}
        </AppText>
      </Animated.View>
    </Animated.View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    bubble: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      height: 40,
      paddingHorizontal: 14,
      marginBottom: theme.spacing.md,
      borderRadius: 18,
      borderBottomLeftRadius: 6,
      backgroundColor: theme.colors.bubbleFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
    },
    dots: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 10,
      gap: 4,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
  });
}
