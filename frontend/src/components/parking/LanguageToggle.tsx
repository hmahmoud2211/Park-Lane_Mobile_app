import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface LanguageToggleProps {
  /** The other language, named in itself: "عربي" or "EN". */
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * Switches a visitor page between English and Arabic. Small enough to sit at
 * the end of the header row without reaching the brand lockup.
 */
export function LanguageToggle({ label, accessibilityLabel, onPress }: LanguageToggleProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Ionicons name="language-outline" size={14} color={theme.colors.textPrimary} />
      <AppText variant="label">{label}</AppText>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    pill: {
      height: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      borderRadius: theme.borderRadius.pill,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
