import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { ArrowRightIcon } from '../ui/ArrowRightIcon';

/**
 * `ring` is the chevron in a circle used by the profile screen. `arrow` is the
 * bare hairline arrow from the My Unit header.
 */
export type BackButtonVariant = 'ring' | 'arrow';

export interface BackButtonProps {
  /** Overrides the default pop-then-fallback behaviour. */
  onPress?: () => void;
  /** Ring diameter, or the arrow's length for the `arrow` variant. */
  size?: number;
  variant?: BackButtonVariant;
  style?: StyleProp<ViewStyle>;
}

/** The `arrow` variant's head is longer than ArrowRightIcon's default. */
const ARROW_HEAD_RATIO = 0.6;

/**
 * Back control. The default ring is styled like the one around the onboarding
 * CTA's arrow, so navigation chrome matches the rest of the system.
 *
 * Pops the stack when there is something to pop, and otherwise routes to the
 * first screen, so it still works if the screen is opened directly.
 */
export function BackButton({ onPress, size, variant = 'ring', style }: BackButtonProps) {
  const theme = useAppTheme();
  const navigation = useNavigation();
  const isArrow = variant === 'arrow';
  const resolvedSize = size ?? (isArrow ? 20 : 36);
  const styles = useMemo(() => createStyles(theme, resolvedSize), [theme, resolvedSize]);

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
      hitSlop={Math.max(0, Math.ceil((44 - resolvedSize) / 2))}
      style={({ pressed }) => [isArrow ? styles.arrow : styles.ring, pressed && styles.pressed, style]}
    >
      {isArrow ? (
        // Mirrored rather than rotated, so the stroke keeps its pixel alignment.
        <View style={styles.mirror}>
          <ArrowRightIcon size={resolvedSize} headRatio={ARROW_HEAD_RATIO} />
        </View>
      ) : (
        <Ionicons name="chevron-back" size={resolvedSize * 0.5} color={theme.colors.textPrimary} />
      )}
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
    arrow: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mirror: {
      transform: [{ scaleX: -1 }],
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
