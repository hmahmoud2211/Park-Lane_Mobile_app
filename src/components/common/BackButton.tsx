import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from './AppText';

export interface BackButtonProps {
  /** Overrides the default pop-then-fallback behaviour. */
  onPress?: () => void;
  /** Ring diameter. */
  size?: number;
  /** The screen's name, set beside the ring as on the Profile header. */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/** The Profile header's back control, used on every screen. */
export const BACK_BUTTON_SIZE = 36;
/** Space between the ring and the title. */
const TITLE_GAP = 16;

/**
 * Back control: a chevron in a hairline ring, styled like the one around the
 * onboarding CTA's arrow, optionally followed by the screen's title. Every
 * screen uses this one look, so the header reads the same throughout the app.
 *
 * Pops the stack when there is something to pop, and otherwise routes to the
 * first screen, so it still works if the screen is opened directly.
 */
export function BackButton({ onPress, size = BACK_BUTTON_SIZE, title, style }: BackButtonProps) {
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

  const ring = (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      // Brings the tap target up to 44dp without enlarging the ring.
      hitSlop={Math.max(0, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => [styles.ring, pressed && styles.pressed, !title && style]}
    >
      <Ionicons name="chevron-back" size={size * 0.5} color={theme.colors.textPrimary} />
    </Pressable>
  );

  if (!title) {
    return ring;
  }

  return (
    <View style={[styles.row, style]}>
      {ring}
      <AppText variant="cardTitle" style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </AppText>
    </View>
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    title: {
      marginLeft: TITLE_GAP,
      flexShrink: 1,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
