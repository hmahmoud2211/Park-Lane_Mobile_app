import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { SmartDevice } from '../../types/ems.types';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { StatusChip } from '../ui/StatusChip';

export interface SmartDeviceCardProps {
  device: SmartDevice;
  /** Omitted where the card only shows the device (e.g. Alexa's access list). */
  onToggle?: (on: boolean) => void;
  /** A command from this screen is waiting for the device. */
  busy?: boolean;
  /** Why the last action from this screen failed. */
  error?: string | null;
  /** Rows under the status line: edit controls, Alexa access. */
  children?: ReactNode;
}

const ICONS: Record<SmartDevice['type'], string> = {
  switch: 'toggle-switch-outline',
  plug: 'power-socket-eu',
  light: 'lightbulb-outline',
  ac: 'air-conditioner',
  virtual: 'toggle-switch-variant',
};

const BADGE_SIZE = 38;
const BADGE_ICON_SIZE = 21;

export function timeAgo(iso: string | null): string {
  if (!iso) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function stateLine(device: SmartDevice): string {
  if (device.pendingPower) {
    return device.pendingPower === 'on' ? 'Turning on…' : 'Turning off…';
  }
  if (device.power === 'unknown') {
    return 'State unknown';
  }
  return `${device.power === 'on' ? 'On' : 'Off'} · confirmed ${timeAgo(device.lastSeen)}`;
}

/**
 * One EMS device: what it is, where it is, whether it is reachable, and the
 * last state it confirmed. A command in flight shows as pending until the
 * device answers, whoever sent it (this phone, another one, or Alexa).
 */
export function SmartDeviceCard({ device, onToggle, busy = false, error, children }: SmartDeviceCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const pending = busy || device.pendingPower !== null;
  const shownOn = (device.pendingPower ?? device.power) === 'on';
  const kind = device.simulated ? 'Virtual switch' : device.type === 'ac' ? 'AC' : device.type;
  const where = [device.room, kind].filter(Boolean).join(' · ');
  const problem = error ?? (!device.online ? device.lastError : null);

  return (
    <GlassSurface
      radius={theme.borderRadius.sm}
      glow={shownOn && device.online}
      blurred={false}
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={styles.surface}
    >
      <View style={styles.row}>
        <View style={[styles.badge, !device.online && styles.dim]}>
          <AppIcon set="material" name={ICONS[device.type]} size={BADGE_ICON_SIZE} />
        </View>
        <View style={styles.text}>
          <AppText variant="statValue" numberOfLines={2}>
            {device.name}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={1}>
            {where}
          </AppText>
        </View>
        {onToggle ? (
          <View style={styles.control}>
            {pending ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} style={styles.spinner} /> : null}
            <ToggleSwitch
              value={shownOn}
              onValueChange={onToggle}
              disabled={pending}
              accessibilityLabel={`${device.name}${device.room ? `, ${device.room}` : ''}`}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.chips}>
        <StatusChip label={device.online ? 'Online' : 'Offline'} tone={device.online ? 'teal' : 'red'} />
        {device.simulated ? <StatusChip label="Virtual" tone="violet" /> : null}
        {device.alexaEnabled ? <StatusChip label="Alexa" tone="indigo" /> : null}
        {device.isDefault ? <StatusChip label="Default" tone="amber" /> : null}
      </View>

      <AppText
        variant="tileCaption"
        color={theme.colors.textAccentSoft}
        accessibilityLiveRegion="polite"
      >
        {stateLine(device)}
      </AppText>
      {problem ? (
        <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
          {problem}
        </AppText>
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
      gap: theme.spacing.sm + theme.spacing.xs,
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
    control: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    spinner: {
      marginRight: theme.spacing.sm,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs + 2,
    },
  });
}
