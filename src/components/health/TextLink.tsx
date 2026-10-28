import { Pressable, StyleSheet } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { AppText } from '../common/AppText';

export interface TextLinkProps {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}

/**
 * A quiet action at the end of a panel's heading, e.g. "See all" or "Show
 * original": accent text with a full-size touch target, where a button
 * would crowd the title.
 */
export function TextLink({ label, onPress, accessibilityHint }: TextLinkProps) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <AppText variant="label" color={theme.colors.accent}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: 32,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
