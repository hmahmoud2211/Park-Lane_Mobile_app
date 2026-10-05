import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AnswerSummary } from '../../services/assistant/assistant.types';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { insightsFor, intentMeta, type Insight, type IntentMeta, type InsightTone } from './insights';

export interface InsightBadgesProps {
  summary?: AnswerSummary;
  /** Opens the screen behind the topic tag, when it has one. */
  onOpenRoute?: (route: NonNullable<IntentMeta['route']>) => void;
  onSignIn?: () => void;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const STAGGER_MS = 70;

/**
 * The topic of a reply and its data caveats, as small chips that pop in one
 * after another under the answer.
 */
function InsightBadgesView({ summary, onOpenRoute, onSignIn, style }: InsightBadgesProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const intent = intentMeta(summary?.intent);
  const insights = useMemo(() => insightsFor(summary), [summary]);

  if (!intent && insights.length === 0) {
    return null;
  }

  const route = intent?.route;

  return (
    <View style={[styles.row, style]}>
      {intent ? (
        <PopIn index={0}>
          <Pressable
            disabled={!route || !onOpenRoute}
            onPress={() => route && onOpenRoute?.(route)}
            accessibilityRole={route ? 'link' : 'text'}
            accessibilityLabel={route ? `Open ${intent.label}` : `Topic: ${intent.label}`}
            style={({ pressed }) => [styles.chip, styles.intent, pressed && styles.pressed]}
          >
            <Ionicons name={intent.icon} size={12} color={theme.colors.accent} />
            <AppText variant="chatMeta" color={theme.colors.textAccentSoft} style={styles.label}>
              {intent.label}
            </AppText>
            {route ? (
              <Ionicons name="arrow-forward" size={10} color={theme.colors.textAccentSoft} style={styles.trailing} />
            ) : null}
          </Pressable>
        </PopIn>
      ) : null}

      {insights.map((insight, index) => (
        <PopIn key={insight.id} index={index + 1}>
          <InsightChip insight={insight} onPress={insight.action === 'sign-in' ? onSignIn : undefined} />
        </PopIn>
      ))}
    </View>
  );
}

function InsightChip({ insight, onPress }: { insight: Insight; onPress?: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tone = toneColors(theme, insight.tone);

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: tone.fill, borderColor: tone.stroke },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={insight.icon} size={12} color={tone.text} />
      <AppText variant="chatMeta" color={tone.text} style={styles.label}>
        {insight.label}
      </AppText>
      {onPress ? <Ionicons name="chevron-forward" size={10} color={tone.text} style={styles.trailing} /> : null}
    </Pressable>
  );
}

/** Fades and springs a chip in, after those before it. */
function PopIn({ index, children }: { index: number; children: ReactNode }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      delay: index * STAGGER_MS,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [index, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

function toneColors(theme: AppTheme, tone: InsightTone) {
  switch (tone) {
    case 'warning':
      return { text: theme.colors.warning, fill: theme.colors.warningFill, stroke: theme.colors.warningStroke };
    case 'error':
      return { text: theme.colors.error, fill: theme.colors.errorFill, stroke: theme.colors.errorStroke };
    case 'info':
    default:
      return { text: theme.colors.textAccentSoft, fill: theme.colors.infoFill, stroke: theme.colors.infoStroke };
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 24,
      paddingHorizontal: 9,
      borderRadius: theme.borderRadius.pill,
      borderWidth: StyleSheet.hairlineWidth * 2,
    },
    intent: {
      backgroundColor: theme.colors.badgeFill,
      borderColor: theme.colors.dividerSubtle,
    },
    label: {
      marginLeft: 5,
    },
    trailing: {
      marginLeft: 4,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}

export const InsightBadges = memo(InsightBadgesView);
