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

/*
 * After the Assistant design (assets/Screens/screen14.png), drawn a little
 * more compact: a 38dp pill, a 26dp avatar 6dp in, the name over the unit
 * code, and a chevron at the end.
 */
const HEIGHT = 38;
const AVATAR_SIZE = 26;
const LIGHT_SIZE = 8;

/** Who the assistant is answering for, with a light for the backend's health. */
export function ResidentChip({ name, unitCode, health, onPress, style }: ResidentChipProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const light =
    health === 'online'
      ? theme.colors.online
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
        <Avatar
          initials={(name ?? '?').slice(0, 1).toUpperCase()}
          size={AVATAR_SIZE}
          variant="flat"
          labelVariant="chipLabel"
        />
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
      height: HEIGHT,
      paddingLeft: 6,
      paddingRight: 12,
      borderRadius: HEIGHT / 2,
      backgroundColor: theme.colors.fieldFill,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.chipVioletStrokeFrom,
      flexShrink: 1,
    },
    light: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: LIGHT_SIZE,
      height: LIGHT_SIZE,
      borderRadius: LIGHT_SIZE / 2,
      borderWidth: 1.5,
      borderColor: theme.colors.backgroundDeep,
    },
    text: {
      flexShrink: 1,
      marginLeft: 8,
      marginRight: 10,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
