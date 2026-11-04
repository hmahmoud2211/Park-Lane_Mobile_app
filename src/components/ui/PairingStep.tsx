import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

/** `numbered` is an instruction; the rest are stages of a running process. */
export type PairingStepState = 'numbered' | 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface PairingStepProps {
  /** Shown in the node of a `numbered` step. */
  index: number;
  title: string;
  body?: string;
  state?: PairingStepState;
  /** Draws the connector down to the next step. */
  connector?: boolean;
  style?: StyleProp<ViewStyle>;
}

/*
 * Not in the design. Built from Maintenance's stage track turned upright: its
 * 17dp-scale nodes, lit cyan when done and violet while in progress, joined
 * by the same 2dp track.
 */
const NODE_SIZE = 26;
const TRACK_WIDTH = 2;
const ICON_SIZE = 14;
const DOT_SIZE = 6;
const TRACK_MIN_HEIGHT = 14;
const TEXT_GAP = 12;
const STEP_GAP = 16;
const PULSE_MS = 900;

/** One step of a vertical timeline: a numbered instruction, or a stage with its state. */
export function PairingStep({ index, title, body, state = 'numbered', connector = false, style }: PairingStepProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduceMotion = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (state !== 'active' || reduceMotion) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, state]);

  const titleColor =
    state === 'pending' || state === 'skipped' ? theme.colors.textSupport : theme.colors.textPrimary;

  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityLabel={`${state === 'numbered' ? `Step ${index}. ` : ''}${title}${
        state !== 'numbered' ? `, ${STATE_LABELS[state]}` : ''
      }${body ? `. ${body}` : ''}`}
    >
      <View style={styles.rail}>
        <Animated.View
          style={[
            styles.node,
            styles[state],
            state === 'active' && {
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
            },
          ]}
        >
          <NodeGlyph state={state} index={index} theme={theme} dotStyle={styles.dot} />
        </Animated.View>
        {connector ? <View style={[styles.track, state === 'done' && styles.trackLit]} /> : null}
      </View>
      <View style={[styles.text, connector && styles.textSpaced]}>
        <AppText variant="statValue" color={titleColor}>
          {title}
        </AppText>
        {body ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.body}>
            {body}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const STATE_LABELS: Record<Exclude<PairingStepState, 'numbered'>, string> = {
  pending: 'not started',
  active: 'in progress',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

function NodeGlyph({
  state,
  index,
  theme,
  dotStyle,
}: {
  state: PairingStepState;
  index: number;
  theme: AppTheme;
  dotStyle: StyleProp<ViewStyle>;
}) {
  switch (state) {
    case 'numbered':
      return <AppText variant="statLabel">{String(index)}</AppText>;
    case 'active':
      return <ActivityIndicator size="small" color={theme.colors.textPrimary} />;
    case 'done':
      return <Ionicons name="checkmark" size={ICON_SIZE} color={theme.colors.textPrimary} />;
    case 'failed':
      return <Ionicons name="close" size={ICON_SIZE} color={theme.colors.error} />;
    case 'skipped':
      return <Ionicons name="remove" size={ICON_SIZE} color={theme.colors.textSupport} />;
    case 'pending':
      return <View style={dotStyle} />;
  }
}

function createStyles(theme: AppTheme) {
  const glow = (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  });

  return StyleSheet.create({
    row: {
      flexDirection: 'row',
    },
    rail: {
      width: NODE_SIZE,
      alignItems: 'center',
    },
    node: {
      width: NODE_SIZE,
      height: NODE_SIZE,
      borderRadius: NODE_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numbered: {
      backgroundColor: theme.colors.badgeFill,
      borderWidth: 1.25,
      borderColor: theme.colors.avatarStroke,
    },
    pending: {
      backgroundColor: theme.colors.backgroundDeep,
      borderWidth: 1.25,
      borderColor: theme.colors.avatarStroke,
    },
    active: {
      backgroundColor: theme.colors.stepActive,
      borderWidth: 1.5,
      borderColor: theme.colors.magenta,
      ...glow(theme.colors.magenta),
    },
    done: {
      backgroundColor: theme.colors.ctaSky,
      borderWidth: 1.5,
      borderColor: theme.colors.electricCyan,
      ...glow(theme.colors.electricCyan),
    },
    failed: {
      backgroundColor: theme.colors.errorFill,
      borderWidth: 1.5,
      borderColor: theme.colors.errorStroke,
    },
    skipped: {
      backgroundColor: theme.colors.backgroundDeep,
      borderWidth: 1.25,
      borderColor: theme.colors.dividerSubtle,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: theme.colors.avatarStroke,
    },
    track: {
      flex: 1,
      // Keeps the link visible between one-line steps.
      minHeight: TRACK_MIN_HEIGHT,
      width: TRACK_WIDTH,
      marginVertical: 3,
      borderRadius: TRACK_WIDTH / 2,
      backgroundColor: theme.colors.dividerSubtle,
    },
    trackLit: {
      backgroundColor: theme.colors.ctaSky,
    },
    text: {
      flex: 1,
      marginLeft: TEXT_GAP,
      // Centres a one-line title on the node.
      paddingTop: 4,
    },
    textSpaced: {
      paddingBottom: STEP_GAP,
    },
    body: {
      marginTop: 3,
    },
  });
}
