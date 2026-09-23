import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface ScreenHeaderProps {
  onMenuPress?: () => void;
  onNotificationsPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const ACTION_SIZE = 34;
const LOCKUP_WIDTH = 132;
const LOCKUP_HEIGHT = 40;

/**
 * Menu, centred brand lockup and notifications. The two actions are equal
 * width, so the lockup stays optically centred without absolute positioning.
 */
export function ScreenHeader({ onMenuPress, onNotificationsPress, style }: ScreenHeaderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={onMenuPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        style={styles.action}
      >
        <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
      </Pressable>

      <Image
        source={images.brandWordmark}
        style={styles.lockup}
        resizeMode="contain"
        accessibilityLabel="Park Lane Compoundhood, New Capital"
      />

      <Pressable
        onPress={onNotificationsPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        style={[styles.action, styles.actionEnd]}
      >
        <Ionicons name="notifications-outline" size={22} color={theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    action: {
      width: ACTION_SIZE,
      height: ACTION_SIZE,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    actionEnd: {
      alignItems: 'flex-end',
    },
    lockup: {
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
      tintColor: theme.colors.textPrimary,
    },
  });
}
