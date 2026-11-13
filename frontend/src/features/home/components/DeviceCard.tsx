import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import { isOn, kindGlyph, kindLabel, stateLine } from '../services/capabilities';
import { problemAdvice } from '../services/deviceLabels';
import type { Device } from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppText } from '../../../components/common/AppText';
import { GlassSurface } from '../../../components/common/GlassSurface';
import { StatusChip } from '../../../components/ui/StatusChip';
import { ControlButton } from './ControlParts';

export interface DeviceCardProps {
  device: Device;
  /** Omitted for devices with nothing to switch, e.g. sensors and locks. */
  onToggle?: (on: boolean) => void;
  /** Opens the device's own screen. */
  onPress?: () => void;
  /** A command from this screen is waiting for the hub. */
  busy?: boolean;
  /** Why the last action from this screen failed. */
  error?: string | null;
  /** Rows under the status line, such as edit controls. */
  children?: ReactNode;
}

const BADGE_SIZE = 44;
const BADGE_ICON_SIZE = 24;
const STATE_ICON_SIZE = 16;
/** The On/Off beside the name: wide enough for its word at large text sizes. */
const POWER_MIN_WIDTH = 92;

/**
 * One device in a list: what it is, where it is and what it is doing in words ("On",
 * "Cleaning", "Cool · 21° → 23°", "Not responding"), with one big On/Off when it has
 * power. Tapping the rest of the card opens the device's own screen. A command in flight
 * shows on the On/Off until the hub answers, whoever sent it (this phone or another one).
 */
export function DeviceCard({ device, onToggle, onPress, busy = false, error, children }: DeviceCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const on = isOn(device);
  const pending = busy || device.pending !== null;
  const glyph = kindGlyph(device.kind);
  const where = [device.room, kindLabel(device.kind)].filter(Boolean).join(' · ');
  const state = stateLine(device);
  const problem = error ?? device.lastError;

  const summary = (
    <>
      <View style={[styles.badge, !device.online && styles.dim]}>
        <AppIcon set={glyph.iconSet} name={glyph.iconName} size={BADGE_ICON_SIZE} />
      </View>
      <View style={styles.text}>
        <AppText variant="controlLabel" numberOfLines={2}>
          {device.name}
        </AppText>
        {where ? (
          <AppText variant="controlCaption" color={theme.colors.textSupport} numberOfLines={2}>
            {where}
          </AppText>
        ) : null}
        <View style={styles.state}>
          {!device.online ? <AppIcon set="material" name="wifi-off" size={STATE_ICON_SIZE} color={theme.colors.warning} /> : null}
          <AppText
            variant="controlCaption"
            color={device.online ? theme.colors.textAccentSoft : theme.colors.warning}
            accessibilityLiveRegion="polite"
            style={styles.stateText}
          >
            {state}
          </AppText>
        </View>
      </View>
    </>
  );

  return (
    <GlassSurface
      radius={theme.borderRadius.sm}
      glow={on === true && device.online}
      blurred={false}
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={styles.surface}
    >
      {/* Siblings, not nested: a screen reader reaches the card and its On/Off separately. */}
      <View style={styles.row}>
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={[device.name, device.room, state].filter(Boolean).join(', ')}
            accessibilityHint="Opens its controls"
            style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
          >
            {summary}
          </Pressable>
        ) : (
          <View style={styles.summary}>{summary}</View>
        )}
        {onToggle && on !== null ? (
          <ControlButton
            label={on ? 'On' : 'Off'}
            icon="power"
            size="regular"
            selected={on}
            busy={pending}
            disabled={!device.online}
            accessibilityLabel={`Turn ${on ? 'off' : 'on'} ${device.name}`}
            accessibilityValueText={on ? 'On' : 'Off'}
            onPress={() => onToggle(!on)}
            style={styles.power}
          />
        ) : null}
      </View>

      {device.source === 'gateway' || device.experimental || (device.assumed && device.online) ? (
        <View style={styles.chips}>
          {device.source === 'gateway' ? <StatusChip label="Local" tone="indigo" icon="wifi-outline" /> : null}
          {device.experimental ? <StatusChip label="Experimental" tone="amber" icon="flask-outline" /> : null}
          {device.assumed && device.online ? <StatusChip label="Not confirmed" tone="slate" icon="help-circle-outline" /> : null}
        </View>
      ) : null}

      {problem ? (
        <View style={styles.state} accessibilityRole="alert">
          <AppIcon set="material" name="alert-circle-outline" size={STATE_ICON_SIZE} color={theme.colors.error} />
          <AppText variant="controlCaption" color={theme.colors.error} style={styles.stateText}>
            {error ? problemAdvice(error) : problem}
          </AppText>
        </View>
      ) : null}

      {children}
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      padding: theme.spacing.md - theme.spacing.xs,
      gap: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    summary: {
      flex: 1,
      minHeight: theme.layout.deviceControl.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    badge: {
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: theme.borderRadius.sm,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dim: {
      opacity: 0.45,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    state: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    stateText: {
      flexShrink: 1,
    },
    power: {
      minWidth: POWER_MIN_WIDTH,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs + 2,
    },
  });
}
