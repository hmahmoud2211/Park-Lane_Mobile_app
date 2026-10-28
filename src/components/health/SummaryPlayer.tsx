import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { formatClock } from '../../services/health/i18n';
import { mediaSource } from '../../services/health/media';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { DirectionView } from '../common/DirectionView';
import { Segmented } from '../parking/Controls';
import { ErrorNotice } from './LoadState';
import { HealthError } from '../../services/health/healthService';

export interface SummaryPlayerCopy {
  play: string;
  pause: string;
  back10: string;
  forward10: string;
  seek: string;
  speed: string;
  lockScreenTitle: string;
  loading: string;
}

export interface SummaryPlayerProps {
  audioUrl: string;
  copy: SummaryPlayerCopy;
}

/**
 * Keeps the summary playing with the screen locked or the app in the
 * background (with UIBackgroundModes audio and the expo-audio plugin's
 * enableBackgroundPlayback in app.json). Lock-screen controls need
 * `doNotMix`.
 */
const SUMMARY_AUDIO_MODE = { playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' } as const;

const RATES = ['1', '1.25', '1.5'] as const;
type Rate = (typeof RATES)[number];
const SKIP_S = 10;

/**
 * The doctor-facing player: large controls, since the phone is often handed
 * across the desk. It keeps playing with the screen locked (expo-audio's
 * background mode, with lock-screen controls so Android doesn't stop it).
 * Media controls keep their left-to-right order in Arabic too, as players
 * conventionally do.
 */
export function SummaryPlayer({ audioUrl, copy }: SummaryPlayerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { service, lang } = useHealth();
  const source = useMemo(() => mediaSource(audioUrl, service.mediaHeaders()), [audioUrl, service]);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<Rate>('1');
  const [scrub, setScrub] = useState<number | null>(null);
  const [seekBar] = useState(() => new SeekBar(setScrub));

  useEffect(() => {
    void setAudioModeAsync(SUMMARY_AUDIO_MODE).catch(() => undefined);
    return () => {
      if (Platform.OS !== 'web') {
        try {
          player.clearLockScreenControls();
        } catch {
          // Released with the player.
        }
      }
    };
  }, [player]);

  const duration = status.duration || 0;
  const position = scrub !== null ? scrub * duration : status.currentTime || 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const seekTo = (seconds: number) => {
    void player.seekTo(Math.max(0, Math.min(duration, seconds)));
  };

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (duration > 0 && position >= duration - 0.25) seekTo(0);
    // Again on each play: the voice assistant sets its own mode, without background play.
    void setAudioModeAsync(SUMMARY_AUDIO_MODE).catch(() => undefined);
    if (Platform.OS !== 'web') {
      try {
        player.setActiveForLockScreen(true, { title: copy.lockScreenTitle }, { showSeekBackward: true, showSeekForward: true });
      } catch {
        // Lock-screen controls are a nicety; playback goes on without them.
      }
    }
    player.play();
  };

  const changeRate = (next: Rate) => {
    setRate(next);
    player.setPlaybackRate(Number(next));
  };

  useEffect(() => {
    seekBar.sync((fraction) => void player.seekTo(fraction * duration));
  }, [seekBar, duration, player]);

  if (status.error) {
    return <ErrorNotice error={new HealthError('server', status.error)} onRetry={() => player.replace(source)} />;
  }

  const ready = status.isLoaded && duration > 0;

  return (
    <DirectionView direction="ltr" style={styles.wrap}>
      <View
        style={styles.barHit}
        onLayout={(event) => seekBar.setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={copy.seek}
        accessibilityValue={{ text: `${formatClock(position, lang)} / ${formatClock(duration, lang)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => seekTo(position + (event.nativeEvent.actionName === 'increment' ? SKIP_S : -SKIP_S))}
        {...seekBar.handlers}
      >
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${progress * 100}%` }]} pointerEvents="none" />
      </View>
      <View style={styles.times}>
        <AppText variant="label" color={theme.colors.textSupport}>
          {formatClock(position, lang)}
        </AppText>
        <AppText variant="label" color={theme.colors.textSupport}>
          {ready ? formatClock(duration, lang) : copy.loading}
        </AppText>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => seekTo(position - SKIP_S)}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={copy.back10}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed, !ready && styles.disabled]}
        >
          <Ionicons name="play-back" size={24} color={theme.colors.textPrimary} />
          <AppText variant="label">10</AppText>
        </Pressable>
        <Pressable
          onPress={toggle}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? copy.pause : copy.play}
          style={({ pressed }) => [styles.play, pressed && styles.pressed, !ready && styles.disabled]}
        >
          {!ready || status.isBuffering ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <Ionicons name={status.playing ? 'pause' : 'play'} size={38} color={theme.colors.textPrimary} />
          )}
        </Pressable>
        <Pressable
          onPress={() => seekTo(position + SKIP_S)}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={copy.forward10}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed, !ready && styles.disabled]}
        >
          <Ionicons name="play-forward" size={24} color={theme.colors.textPrimary} />
          <AppText variant="label">10</AppText>
        </Pressable>
      </View>

      <Segmented
        accessibilityLabel={copy.speed}
        options={RATES.map((value) => ({ value, label: `${value}×` }))}
        value={rate}
        onChange={changeRate}
      />
    </DirectionView>
  );
}

/**
 * The seek bar's drag, outside React: reports the fraction under the finger
 * while dragging, and seeks there on release.
 */
class SeekBar {
  readonly handlers;
  private width = 0;
  private seek: (fraction: number) => void = () => undefined;

  constructor(onScrub: (fraction: number | null) => void) {
    const at = (event: GestureResponderEvent) =>
      this.width > 0 ? Math.min(1, Math.max(0, event.nativeEvent.locationX / this.width)) : 0;
    this.handlers = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => onScrub(at(event)),
      onPanResponderMove: (event) => onScrub(at(event)),
      onPanResponderRelease: (event) => {
        this.seek(at(event));
        onScrub(null);
      },
      onPanResponderTerminate: () => onScrub(null),
    }).panHandlers;
  }

  setWidth(width: number) {
    this.width = width;
  }

  sync(seek: (fraction: number) => void) {
    this.seek = seek;
  }
}

const PLAY_SIZE = 76;
const SKIP_SIZE = 58;
const THUMB = 18;

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    wrap: {
      gap: 12,
    },
    barHit: {
      height: 36,
      justifyContent: 'center',
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.surfaceSubtle,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      backgroundColor: theme.colors.accent,
    },
    thumb: {
      position: 'absolute',
      width: THUMB,
      height: THUMB,
      marginLeft: -THUMB / 2,
      borderRadius: THUMB / 2,
      backgroundColor: theme.colors.white,
      borderWidth: 2,
      borderColor: theme.colors.accent,
    },
    times: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: -6,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      paddingVertical: 4,
    },
    play: {
      width: PLAY_SIZE,
      height: PLAY_SIZE,
      borderRadius: PLAY_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.ctaRoyal,
      borderWidth: 2,
      borderColor: theme.colors.accent,
      ...theme.shadows.glow,
    },
    skip: {
      width: SKIP_SIZE,
      height: SKIP_SIZE,
      borderRadius: SKIP_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.badgeFill,
    },
    pressed: {
      opacity: 0.7,
      transform: [{ scale: 0.97 }],
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
