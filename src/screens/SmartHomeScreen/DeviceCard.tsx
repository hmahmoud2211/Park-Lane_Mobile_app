import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import type { IconSet } from '../../components/ui/ServiceTile';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface DeviceCardProps {
  name: string;
  location: string;
  iconSet: IconSet;
  iconName: string;
  statusLabel: string;
  online: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onPress: () => void;
}

/*
 * Measured on the Smart Home reference (assets/Screens/screen10.png): an icon
 * badge, drawn 30dp, beside the name, room and status, with the switch and a
 * chevron down the right.
 */
const PADDING = 8;
const BADGE_SIZE = 30;
const BADGE_ICON_SIZE = 17;
const BADGE_TO_TEXT = 8;
const DOT_SIZE = 5;
const CHEVRON_SIZE = 11;
const STATUS_TOP = 7;

/** One device in the Smart Home "Smart Devices" panel. Laid on the panel's glass. */
export function DeviceCard({
  name,
  location,
  iconSet,
  iconName,
  statusLabel,
  online,
  enabled,
  onToggle,
  onPress,
}: DeviceCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${location}, ${statusLabel}`}
      accessibilityHint="Shows the device"
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        glow
        blurred={false}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.surface}
      >
        <View style={[styles.badge, !enabled && styles.dim]}>
          <AppIcon set={iconSet} name={iconName} size={BADGE_ICON_SIZE} />
        </View>

        <View style={styles.text}>
          <View style={styles.titleRow}>
            {/* Inter is far wider than the design face, so a long name takes a
                second line rather than truncating; the status row stays at the foot. */}
            <AppText variant="statValue" numberOfLines={2} style={styles.name}>
              {name}
            </AppText>
            <ToggleSwitch value={enabled} onValueChange={onToggle} accessibilityLabel={name} />
          </View>
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={1}>
            {location}
          </AppText>

          <View style={styles.statusRow}>
            <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
            <AppText variant="statLabel" color={theme.colors.textAccentSoft} style={styles.status}>
              {statusLabel}
            </AppText>
            <Ionicons name="chevron-forward" size={CHEVRON_SIZE} color={theme.colors.textPrimary} />
          </View>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    // Fills its grid cell, so both cards in a row match the taller one.
    root: {
      flexGrow: 1,
    },
    surface: {
      flexGrow: 1,
      flexDirection: 'row',
      padding: PADDING,
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
      marginLeft: BADGE_TO_TEXT,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.xs,
    },
    name: {
      flex: 1,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 'auto',
      paddingTop: STATUS_TOP,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      marginRight: theme.spacing.xs,
    },
    dotOnline: {
      backgroundColor: theme.colors.online,
    },
    dotOffline: {
      backgroundColor: theme.colors.textMuted,
    },
    status: {
      flex: 1,
    },
    pressed: {
      opacity: 0.8,
    },
  });
}
