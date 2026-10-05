import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { isRtlText } from './RichText';

export interface Suggestion {
  id: string;
  /** Asks one thing: the assistant answers one topic per question. */
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export interface SuggestionChipsProps {
  suggestions: readonly Suggestion[];
  onPick: (text: string) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const STAGGER_MS = 55;
const BASE_DELAY_MS = 180;

/** Example questions that cascade in, one after another. */
export function SuggestionChips({ suggestions, onPick, disabled, style }: SuggestionChipsProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [progress] = useState(() => suggestions.map(() => new Animated.Value(0)));

  useEffect(() => {
    const cascade = Animated.stagger(
      STAGGER_MS,
      progress.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
      ),
    );
    const timer = setTimeout(() => cascade.start(), BASE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cascade.stop();
    };
  }, [progress]);

  return (
    <View style={[styles.wrap, style]}>
      {suggestions.map((suggestion, index) => {
        const value = progress[index];
        const rtl = isRtlText(suggestion.text);
        return (
          <Animated.View
            key={suggestion.id}
            style={[
              styles.cell,
              value && {
                opacity: value,
                transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}
          >
            <Pressable
              disabled={disabled}
              onPress={() => onPick(suggestion.text)}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${suggestion.text}`}
              style={({ pressed }) => [styles.chip, rtl && styles.chipRtl, pressed && styles.pressed]}
            >
              <View style={styles.icon}>
                <Ionicons name={suggestion.icon} size={14} color={theme.colors.accent} />
              </View>
              <AppText
                variant="chipLabel"
                numberOfLines={2}
                style={[styles.label, rtl ? styles.labelRtl : null]}
              >
                {suggestion.text}
              </AppText>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -5,
    },
    cell: {
      width: '50%',
      padding: 5,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.bubbleFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
    },
    chipRtl: {
      flexDirection: 'row-reverse',
    },
    icon: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.infoFill,
    },
    label: {
      flex: 1,
      marginHorizontal: 8,
    },
    labelRtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    pressed: {
      opacity: 0.7,
      transform: [{ scale: 0.97 }],
    },
  });
}
