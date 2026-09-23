import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

/**
 * `glass` matches the rest of the system. `flat` exists because nesting one
 * blur inside another composites as a visible square patch, so an avatar
 * placed on top of another glass panel must use the flat chip.
 */
export type AvatarVariant = 'glass' | 'flat';

export interface AvatarProps {
  /** Usually two characters, e.g. "AH". */
  initials: string;
  size?: number;
  variant?: AvatarVariant;
  style?: StyleProp<ViewStyle>;
}

/** Circular avatar showing a resident's initials. */
export function Avatar({ initials, size = 40, variant = 'glass', style }: AvatarProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, size), [theme, size]);

  const label = (
    <AppText variant="tileTitle" color={theme.colors.textPrimary} style={styles.label}>
      {initials}
    </AppText>
  );

  if (variant === 'flat') {
    return <View style={[styles.flat, style]}>{label}</View>;
  }

  return (
    <GlassSurface radius={size / 2} style={[styles.glass, style]}>
      {label}
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme, size: number) {
  const base = {
    width: size,
    height: size,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return StyleSheet.create({
    glass: base,
    flat: {
      ...base,
      borderRadius: size / 2,
      backgroundColor: theme.colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    label: {
      // Optical centring: the cap-height box sits low in the line box.
      marginTop: 1,
      letterSpacing: 0.4,
    },
  });
}
