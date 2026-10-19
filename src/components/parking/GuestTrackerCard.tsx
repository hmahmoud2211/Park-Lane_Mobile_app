import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { GuestTracker, TrackState, TrackStep } from '../../services/parking/tracking';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { toneLook } from './Notice';

const SHORT: Record<TrackStep['key'], string> = {
  booked: 'Booked',
  shared: 'Shared',
  arrived: 'Arrived',
  parked: 'Parked',
  left: 'Left',
  ended: '',
};

const STATE_WORDS: Record<TrackState, string> = {
  done: 'done',
  current: 'now',
  upcoming: 'not yet',
  problem: 'needs attention',
};

function stepLook(theme: AppTheme, state: TrackState) {
  switch (state) {
    case 'done':
      return toneLook(theme, 'success');
    case 'current':
      return toneLook(theme, 'info');
    case 'problem':
      return toneLook(theme, 'warning');
    case 'upcoming':
      return { fill: theme.colors.badgeFill, stroke: theme.colors.dividerSubtle, icon: theme.colors.textMuted };
  }
}

/**
 * Where a guest's visit stands, in one band: a headline, the milestones from
 * booking to leaving as a row, and the one detail that matters now (the step
 * in progress, or the last one done). Every milestone is a stored record
 * (the booking, the share, a gate scan, the bay), never the guest's location.
 */
export function GuestTrackerStrip({ tracker }: { tracker: GuestTracker }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const headline = toneLook(theme, tracker.tone);
  const focus =
    tracker.steps.find((s) => s.state === 'problem' || s.state === 'current') ??
    [...tracker.steps].reverse().find((s) => s.state === 'done');

  return (
    <View style={styles.wrap}>
      <View style={styles.headline} accessibilityLiveRegion="polite">
        <View style={[styles.liveDot, { backgroundColor: headline.icon }]} />
        <AppText variant="bodyStrong" style={styles.flex}>
          {tracker.headline}
        </AppText>
      </View>

      <View style={styles.row} accessibilityRole="list">
        {tracker.steps.map((step, index) => {
          const look = stepLook(theme, step.state);
          const last = index === tracker.steps.length - 1;
          return (
            <View
              key={step.key}
              style={styles.step}
              accessible
              accessibilityLabel={[step.title, step.detail, STATE_WORDS[step.state]].filter(Boolean).join(', ')}
            >
              <View style={styles.track}>
                <View style={[styles.node, { backgroundColor: look.fill, borderColor: look.stroke }]}>
                  <Ionicons name={step.icon as keyof typeof Ionicons.glyphMap} size={13} color={look.icon} />
                </View>
                {!last ? (
                  <View style={[styles.line, { backgroundColor: step.state === 'done' ? look.stroke : theme.colors.dividerSubtle }]} />
                ) : null}
              </View>
              <AppText
                variant="label"
                numberOfLines={1}
                color={step.state === 'upcoming' ? theme.colors.textMuted : theme.colors.textPrimary}
              >
                {SHORT[step.key] || step.title}
              </AppText>
            </View>
          );
        })}
      </View>

      {focus?.detail ? (
        <AppText variant="label" color={theme.colors.textSupport}>
          {`${focus.title}: ${focus.detail}`}
        </AppText>
      ) : null}
    </View>
  );
}

const NODE = 26;

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    wrap: {
      gap: 10,
    },
    flex: {
      flex: 1,
    },
    headline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    row: {
      flexDirection: 'row',
    },
    step: {
      flex: 1,
      gap: 4,
    },
    track: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    node: {
      width: NODE,
      height: NODE,
      borderRadius: NODE / 2,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    line: {
      flex: 1,
      height: 2,
      marginHorizontal: 3,
      borderRadius: 1,
    },
  });
}
