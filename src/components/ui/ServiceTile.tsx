import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export type IconSet = 'ionicons' | 'material';

export interface ServiceTileProps {
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const MIN_HEIGHT = 45;
const ICON_SIZE = 21;

/**
 * One entry in the home screen's service grid: icon, title, supporting line and
 * a chevron. Grows past `MIN_HEIGHT` when the title wraps, so a two-line label
 * or a large system font size never clips.
 */
export function ServiceTile({
  title,
  subtitle,
  iconSet,
  iconName,
  onPress,
  style,
}: ServiceTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // The icon sets do not share a name union, so the name is typed per set.
  const icon =
    iconSet === 'ionicons' ? (
      <Ionicons
        name={iconName as keyof typeof Ionicons.glyphMap}
        size={ICON_SIZE}
        color={theme.colors.textPrimary}
      />
    ) : (
      <MaterialCommunityIcons
        name={iconName as keyof typeof MaterialCommunityIcons.glyphMap}
        size={ICON_SIZE}
        color={theme.colors.textPrimary}
      />
    );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <GlassSurface
        radius={theme.borderRadius.md}
        stroke="gradient"
        style={styles.surface}
      >
        {icon}
        <View style={styles.text}>
          <AppText variant="tileTitle">{title}</AppText>
          <AppText variant="tileSubtitle" color={theme.colors.textSecondary}>
            {subtitle}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: 8,
    },
    text: {
      flex: 1,
      marginLeft: 8,
      marginRight: 2,
    },
    pressed: {
      opacity: 0.75,
    },
  });
}
