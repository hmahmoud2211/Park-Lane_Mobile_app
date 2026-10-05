import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { Avatar } from '../ui/Avatar';

export type AssistantHealthState = 'checking' | 'online' | 'degraded' | 'offline';

export interface ResidentChipProps {
  /** `null` for a guest. */
  name: string | null;
  unitCode?: string;
  health: AssistantHealthState;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Who the assistant is answering for, with a light for the backend's health. */
export function ResidentChip({ name, unitCode, health, onPress, style }: ResidentChipProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const light =
    health === 'online'
      ? theme.colors.success
      : health === 'degraded'
        ? theme.colors.warning
        : health === 'offline'
          ? theme.colors.error
          : theme.colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Answering for ${name ?? 'a guest'}. Change resident`}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed, style]}
    >
      <View>
        <Avatar initials={(name ?? '?').slice(0, 1).toUpperCase()} size={26} variant="flat" labelVariant="chatMeta" />
        <View style={[styles.light, { backgroundColor: light }]} />
      </View>
      <View style={styles.text}>
        <AppText variant="chipLabel" numberOfLines={1}>
          {name ?? 'Guest'}
        </AppText>
        <AppText variant="chatMeta" color={theme.colors.textSupport} numberOfLines={1}>
          {unitCode ?? 'Not signed in'}
        </AppText>
      </View>
      <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 38,
      paddingLeft: 6,
      paddingRight: 10,
      borderRadius: 19,
      backgroundColor: theme.colors.fieldFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.dividerSubtle,
      flexShrink: 1,
    },
    light: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: 9,
      height: 9,
      borderRadius: 4.5,
      borderWidth: 1.5,
      borderColor: theme.colors.backgroundDeep,
    },
    text: {
      flexShrink: 1,
      marginLeft: 8,
      marginRight: 6,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
