import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface BackButtonProps {
  /** Overrides the default pop-then-fallback behaviour. */
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Circular back control, styled like the ring around the onboarding CTA's
 * arrow so navigation chrome matches the rest of the system.
 *
 * Pops the stack when there is something to pop, and otherwise routes to the
 * first screen, so it still works if the screen is opened directly.
 */
export function BackButton({ onPress, size = 36, style }: BackButtonProps) {
  const theme = useAppTheme();
  const navigation = useNavigation();
  const styles = useMemo(() => createStyles(theme, size), [theme, size]);

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('FirstScreen');
    }
  }, [onPress, navigation]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      // Brings the tap target up to 44dp without enlarging the ring.
      hitSlop={Math.max(0, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => [styles.ring, pressed && styles.pressed, style]}
    >
      <Ionicons name="chevron-back" size={size * 0.5} color={theme.colors.textPrimary} />
    </Pressable>
  );
}

function createStyles(theme: AppTheme, size: number) {
  return StyleSheet.create({
    ring: {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.transparent,
      alignItems: 'center',
      justifyContent: 'center',
      // Nudges the chevron off centre-left so it reads as optically centred.
      paddingRight: 2,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
