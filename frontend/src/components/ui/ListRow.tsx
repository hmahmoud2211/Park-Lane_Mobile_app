import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { StatusChip, type StatusTone } from './StatusChip';

export interface ListRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  lines?: readonly string[];
  statusLabel?: string;
  statusTone?: StatusTone;
  onPress?: () => void;
  divided?: boolean;
  accessibilityHint?: string;
}

/** One booking, event or alert in a list, with readable type and its status. */
export function ListRow({ icon, title, lines = [], statusLabel, statusTone, onPress, divided, accessibilityHint }: ListRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[title, ...lines, statusLabel].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.badge}>
        <Ionicons name={icon} size={18} color={theme.colors.textPrimary} />
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {lines.map((line, index) => (
          <AppText key={`${index}-${line}`} variant="label" color={theme.colors.textSupport} numberOfLines={2}>
            {line}
          </AppText>
        ))}
      </View>
      {statusLabel && statusTone ? <StatusChip label={statusLabel} tone={statusTone} style={styles.chip} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={theme.colors.textSupport} /> : null}
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 10,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    pressed: {
      opacity: 0.7,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      gap: 2,
    },
    chip: {
      minWidth: 74,
    },
  });
}
