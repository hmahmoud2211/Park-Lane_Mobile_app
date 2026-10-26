import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { isOn, kindGlyph, kindLabel, stateLine } from '../../services/home/capabilities';
import type { Device } from '../../types/home.types';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { StatusChip } from '../ui/StatusChip';

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

const BADGE_SIZE = 38;
const BADGE_ICON_SIZE = 21;

/**
 * One device in the resident's home: what it is, where it is, whether it is
 * reachable, and what it is doing. A command in flight shows as pending
 * until the hub answers, whoever sent it (this phone or another one).
 */
export function DeviceCard({ device, onToggle, onPress, busy = false, error, children }: DeviceCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const on = isOn(device);
  const pending = busy || device.pending !== null;
  const glyph = kindGlyph(device.kind);
  const where = [device.room, kindLabel(device.kind)].filter(Boolean).join(' · ');
  const problem = error ?? device.lastError;

  const header = (
    <View style={styles.row}>
      <View style={[styles.badge, !device.online && styles.dim]}>
        <AppIcon set={glyph.iconSet} name={glyph.iconName} size={BADGE_ICON_SIZE} />
      </View>
      <View style={styles.text}>
        <AppText variant="statValue" numberOfLines={2}>
          {device.name}
        </AppText>
        <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={1}>
          {where}
        </AppText>
      </View>
      {onToggle && on !== null ? (
        <View style={styles.control}>
          {pending ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} style={styles.spinner} /> : null}
          <ToggleSwitch
            value={on}
            onValueChange={onToggle}
            disabled={pending || !device.online}
            accessibilityLabel={`${device.name}${device.room ? `, ${device.room}` : ''}`}
          />
        </View>
      ) : null}
    </View>
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
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${device.name}, ${stateLine(device)}`}
          accessibilityHint="Shows the device's controls"
          style={({ pressed }) => pressed && styles.pressed}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}

      <View style={styles.chips}>
        <StatusChip label={device.online ? 'Online' : 'Offline'} tone={device.online ? 'teal' : 'red'} />
      </View>

      <AppText variant="tileCaption" color={theme.colors.textAccentSoft} accessibilityLiveRegion="polite">
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
