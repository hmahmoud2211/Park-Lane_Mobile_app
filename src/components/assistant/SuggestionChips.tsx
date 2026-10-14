import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { NeonPanel } from '../ui/NeonPanel';
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

/*
 * From the Assistant design (assets/Screens/screen14.png): neon cards two
 * across, 57dp tall and 10dp apart, a cyan glyph 17dp in, the question 16dp
 * beyond it and a chevron at the end.
 */
const CARD_GAP = 10;
const MIN_HEIGHT = 57;
const ICON_SIZE = 22;
const CHEVRON_SIZE = 15;

/** Example questions as cards that cascade in, one after another. */
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
              style={({ pressed }) => [styles.fill, pressed && styles.pressed]}
            >
              <NeonPanel style={[styles.chip, rtl && styles.chipRtl]}>
                <Ionicons name={suggestion.icon} size={ICON_SIZE} color={theme.colors.accent} />
                <AppText
                  variant="chipLabel"
                  numberOfLines={2}
                  style={[styles.label, rtl ? styles.labelRtl : null]}
                >
                  {suggestion.text}
                </AppText>
                <Ionicons
                  name={rtl ? 'chevron-back' : 'chevron-forward'}
                  size={CHEVRON_SIZE}
                  color={theme.colors.textSecondary}
                />
              </NeonPanel>
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
      margin: -CARD_GAP / 2,
    },
    cell: {
      width: '50%',
      padding: CARD_GAP / 2,
    },
    fill: {
      flex: 1,
    },
    chip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: MIN_HEIGHT,
      paddingLeft: 17,
      paddingRight: 11,
      paddingVertical: theme.spacing.sm,
    },
    chipRtl: {
      flexDirection: 'row-reverse',
      paddingLeft: 11,
      paddingRight: 17,
    },
    // 84dp at 390dp: room for "Any active alarms" on one line, while the
    // longer questions break where the design breaks them.
    label: {
      flex: 1,
      marginLeft: 16,
      marginRight: 8,
    },
    labelRtl: {
      marginLeft: 8,
      marginRight: 16,
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    pressed: {
      opacity: 0.7,
      transform: [{ scale: 0.97 }],
    },
  });
}
