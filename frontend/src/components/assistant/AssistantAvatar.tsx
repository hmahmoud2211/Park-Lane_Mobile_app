import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface AssistantAvatarProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A still miniature of the orb, for message headers. Many can be on screen at
 * once, so unlike AssistantOrb it does not animate.
 */
export function AssistantAvatar({ size = 16, style }: AssistantAvatarProps) {
  const theme = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        shell: {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.colors.frameStroke,
        },
        gloss: {
          position: 'absolute',
          left: size * 0.18,
          top: size * 0.14,
          width: size * 0.34,
          height: size * 0.26,
          borderRadius: size,
          backgroundColor: theme.colors.orbGloss,
          opacity: 0.6,
        },
      }),
    [size, theme],
  );

  return (
    <View style={[styles.shell, style]}>
      <LinearGradient
        colors={[theme.colors.electricCyan, theme.colors.neonBlue, theme.colors.violet, theme.colors.magenta]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.gloss} />
    </View>
  );
}
