import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface ProgressStep {
  id: string;
  label: string;
  /** Lines under the label, e.g. the date and time the stage was reached. */
  details?: readonly string[];
}

export interface ProgressStepperProps {
  steps: readonly ProgressStep[];
  /** Index of the stage in progress; earlier stages are done, later ones pending. */
  currentIndex: number;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Maintenance design (assets/Screens/screen6.png): 17dp nodes on a
 * 2dp track, one equal column per stage, the track lit from the first node
 * to the current one.
 */
const NODE_SIZE = 17;
const TRACK_HEIGHT = 2;
const DOT_SIZE = 5;
const CHECK_SIZE = 12;
const LABEL_TOP = 7;
const DETAILS_TOP = 3;

type StepState = 'done' | 'current' | 'pending';

/** A request's stages as a horizontal track, e.g. Submitted to Completed. */
export function ProgressStepper({ steps, currentIndex, style }: ProgressStepperProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const count = steps.length;
  const current = Math.min(Math.max(currentIndex, 0), count - 1);
  // The track runs between the first and last node centres, half a column in.
  const edge = `${50 / count}%` as const;
  const lit = count > 1 ? current / (count - 1) : 0;

  const stateOf = (index: number): StepState =>
    index < current ? 'done' : index === current ? 'current' : 'pending';

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${steps[current]?.label ?? ''}, stage ${current + 1} of ${count}`}
    >
      <View style={[styles.track, { left: edge, right: edge }]} pointerEvents="none">
        {lit > 0 ? (
          <LinearGradient
            colors={[theme.colors.ctaSky, theme.colors.ctaSky, theme.colors.stepActive]}
            // Solid up to the stage before the current one, then into violet.
            locations={[0, current > 1 ? (current - 1) / current : 0, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.trackLit, { width: `${lit * 100}%` }]}
          />
        ) : null}
      </View>

      {steps.map((step, index) => {
        const state = stateOf(index);
        return (
          <View key={step.id} style={styles.column}>
            <View style={[styles.node, styles[state]]}>
              {state === 'done' ? (
                <Ionicons name="checkmark" size={CHECK_SIZE} color={theme.colors.textPrimary} />
              ) : (
                <View style={[styles.dot, state === 'pending' && styles.dotPending]} />
              )}
            </View>
            <AppText
              variant={state === 'pending' ? 'tileSubtitle' : 'fieldValue'}
              color={state === 'pending' ? theme.colors.textSupport : theme.colors.textPrimary}
              numberOfLines={1}
              style={styles.label}
            >
              {step.label}
            </AppText>
            <View style={styles.details}>
              {(step.details?.length ? step.details : ['—']).map((line) => (
                <AppText
                  key={line}
                  variant="tileCaption"
                  color={theme.colors.textSupport}
                  numberOfLines={1}
                >
                  {line}
                </AppText>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const glow = (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  });

  return StyleSheet.create({
    row: {
      flexDirection: 'row',
    },
    track: {
      position: 'absolute',
      top: (NODE_SIZE - TRACK_HEIGHT) / 2,
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.dividerSubtle,
      overflow: 'hidden',
    },
    trackLit: {
      height: '100%',
    },
    column: {
      flex: 1,
      alignItems: 'center',
    },
    node: {
      width: NODE_SIZE,
      height: NODE_SIZE,
      borderRadius: NODE_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    done: {
      backgroundColor: theme.colors.ctaSky,
      borderWidth: 1.5,
      borderColor: theme.colors.electricCyan,
      ...glow(theme.colors.electricCyan),
    },
    current: {
      backgroundColor: theme.colors.stepActive,
      borderWidth: 1.5,
      borderColor: theme.colors.magenta,
      ...glow(theme.colors.magenta),
    },
    // Opaque, so the unlit track does not show through the hollow ring.
    pending: {
      backgroundColor: theme.colors.backgroundDeep,
      borderWidth: 1.25,
      borderColor: theme.colors.avatarStroke,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: theme.colors.textPrimary,
    },
    dotPending: {
      backgroundColor: theme.colors.avatarStroke,
    },
    label: {
      marginTop: LABEL_TOP,
    },
    details: {
      marginTop: DETAILS_TOP,
      alignItems: 'center',
    },
  });
}
