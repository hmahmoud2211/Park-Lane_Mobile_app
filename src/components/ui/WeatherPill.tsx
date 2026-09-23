import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export interface WeatherPillProps {
  temperature: string;
  condition: string;
  style?: StyleProp<ViewStyle>;
}

/** Current conditions beside the greeting. */
export function WeatherPill({ temperature, condition, style }: WeatherPillProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <GlassSurface radius={theme.borderRadius.lg} tinted={false} style={[styles.surface, style]}>
      <Ionicons name="moon" size={22} color={theme.colors.textPrimary} />
      <View style={styles.text}>
        <AppText variant="cardTitle">{temperature}</AppText>
        <AppText variant="tileSubtitle" color={theme.colors.textSecondary}>
          {condition}
        </AppText>
      </View>
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    text: {
      marginLeft: theme.spacing.sm,
    },
  });
}
