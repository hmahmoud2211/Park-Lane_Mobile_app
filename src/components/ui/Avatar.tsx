import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface AvatarProps {
  /** Usually two characters, e.g. "AH". */
  initials: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Circular avatar showing a resident's initials.
 *
 * A flat translucent chip rather than a GlassSurface: this sits inside other
 * glass panels, and nesting one blur inside another makes the inner layer
 * composite as a visible square patch instead of a circle.
 */
export function Avatar({ initials, size = 34, style }: AvatarProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, size), [theme, size]);

  return (
    <View style={[styles.circle, style]}>
      <AppText variant="tileTitle" color={theme.colors.textPrimary} style={styles.label}>
        {initials}
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme, size: number) {
  return StyleSheet.create({
    circle: {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: theme.colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    label: {
      // Optical centring: the cap-height box sits low in the line box.
      marginTop: 1,
      letterSpacing: 0.4,
    },
  });
}
