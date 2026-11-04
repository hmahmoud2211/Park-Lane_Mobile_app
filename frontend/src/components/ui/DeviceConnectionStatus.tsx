import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

/**
 * `idle` before anything has been tried, `working` while it is, then the
 * observed result. `warning` is a partial result, e.g. found but not added.
 */
export type ConnectionTone = 'idle' | 'working' | 'success' | 'warning' | 'error';

export interface ConnectionDetail {
  label: string;
  value: string;
  /** Marks a value that is not confirmed, e.g. a model the device did not report. */
  muted?: boolean;
}

export interface DeviceConnectionStatusProps {
  tone: ConnectionTone;
  title: string;
  caption?: string;
  /** What the link joins: the phone to the plug's hotspot, or the hub to the plug. */
  from?: 'phone' | 'hub';
  details?: readonly ConnectionDetail[];
  style?: StyleProp<ViewStyle>;
}

/*
 * Not in the design. The phone and the plug in the device cards' badge rings,
 * joined by a dotted link that runs while connecting and settles to the
 * result's colour.
 */
const END_SIZE = 52;
const END_ICON_SIZE = 26;
const DOTS = 5;
const DOT_SIZE = 6;
const RESULT_SIZE = 22;
const RESULT_ICON_SIZE = 14;
const STEP_MS = 160;

export function DeviceConnectionStatus({
  tone,
  title,
  caption,
  from = 'phone',
  details,
  style,
}: DeviceConnectionStatusProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduceMotion = useReduceMotion();
  const [sweep] = useState(() => new Animated.Value(0));
  const color = toneColor(theme, tone);

  useEffect(() => {
    if (tone !== 'working' || reduceMotion) {
      sweep.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: DOTS + 1,
        duration: STEP_MS * (DOTS + 1),
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep, tone]);

  const result =
    tone === 'success' ? 'checkmark' : tone === 'error' ? 'close' : tone === 'warning' ? 'alert' : null;

  return (
    <View style={style} accessibilityLiveRegion="polite">
      <View style={styles.link} accessible accessibilityLabel={`${title}${caption ? `. ${caption}` : ''}`}>
        <View style={styles.end}>
          {from === 'phone' ? (
            <Ionicons name="phone-portrait-outline" size={END_ICON_SIZE} color={theme.colors.textPrimary} />
          ) : (
            <MaterialCommunityIcons name="router-wireless" size={END_ICON_SIZE} color={theme.colors.textPrimary} />
          )}
        </View>

        <View style={styles.dots}>
          {Array.from({ length: DOTS }, (_, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                { backgroundColor: tone === 'idle' ? theme.colors.avatarStroke : color },
                tone === 'working' && !reduceMotion
                  ? {
                      opacity: sweep.interpolate({
                        inputRange: [index, index + 0.5, index + 1.5],
                        outputRange: [0.25, 1, 0.25],
                        extrapolate: 'clamp',
                      }),
                    }
                  : null,
              ]}
            />
          ))}
          {result ? (
            <View style={[styles.result, { borderColor: color }]}>
              <Ionicons name={result} size={RESULT_ICON_SIZE} color={color} />
            </View>
          ) : null}
        </View>

        <View style={[styles.end, tone === 'success' && { borderColor: color }]}>
          <MaterialCommunityIcons name="power-plug-outline" size={END_ICON_SIZE} color={theme.colors.textPrimary} />
        </View>
      </View>

      <AppText variant="sectionTitle" align="center" style={styles.title}>
        {title}
      </AppText>
      {caption ? (
        <AppText variant="tileCaption" align="center" color={theme.colors.textSupport} style={styles.caption}>
          {caption}
        </AppText>
      ) : null}

      {details?.length ? (
        <View style={styles.details}>
          {details.map((detail, index) => (
            <View key={detail.label} style={[styles.detailRow, index > 0 && styles.detailDivider]}>
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {detail.label}
              </AppText>
              <AppText
                variant="statValue"
                color={detail.muted ? theme.colors.textSupport : theme.colors.textPrimary}
                style={styles.detailValue}
                selectable
              >
                {detail.value}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function toneColor(theme: AppTheme, tone: ConnectionTone): string {
  switch (tone) {
    case 'idle':
    case 'working':
      return theme.colors.electricCyan;
    case 'success':
      return theme.colors.success;
    case 'warning':
      return theme.colors.warning;
    case 'error':
      return theme.colors.error;
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    end: {
      width: END_SIZE,
      height: END_SIZE,
      borderRadius: END_SIZE / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dots: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      marginHorizontal: theme.spacing.md,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    // Over the middle dot, so the link reads phone, result, plug.
    result: {
      position: 'absolute',
      width: RESULT_SIZE,
      height: RESULT_SIZE,
      borderRadius: RESULT_SIZE / 2,
      borderWidth: 1.5,
      backgroundColor: theme.colors.backgroundDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      marginTop: theme.spacing.md,
    },
    caption: {
      marginTop: theme.spacing.xs,
    },
    details: {
      marginTop: theme.spacing.md,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      paddingHorizontal: theme.spacing.sm + 4,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm + 2,
      gap: theme.spacing.md,
    },
    detailDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    detailValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
  });
}
