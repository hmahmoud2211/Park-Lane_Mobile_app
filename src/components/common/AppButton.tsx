import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from './AppText';

export type AppButtonVariant = 'primary' | 'secondary';

export interface AppButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: AppButtonVariant;
  /** Rendered in a circular frame inset at the leading edge. */
  leadingIcon?: ReactNode;
  loading?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  title,
  variant = 'primary',
  leadingIcon,
  loading = false,
  disabled = false,
  height = 56,
  style,
  ...rest
}: AppButtonProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);

  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.shell,
        isPrimary && styles.shellGlow,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.clip}>
        {isPrimary ? (
          <>
            {/* Glass */}
            <BlurView
              intensity={theme.glass.blurIntensity}
              tint={theme.glass.blurTint}
              style={StyleSheet.absoluteFill}
            />
            {/* Linear gradient fill at 20% */}
            <LinearGradient
              colors={[...theme.glass.gradientColors]}
              start={theme.glass.gradientStart}
              end={theme.glass.gradientEnd}
              style={[StyleSheet.absoluteFill, { opacity: theme.glass.fillOpacity }]}
            />
          </>
        ) : null}

        {/* Label is centred on the button, not on the space beside the icon. */}
        <View style={styles.labelLayer} pointerEvents="none">
          {loading ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <AppText variant="button">{title}</AppText>
          )}
        </View>

        {leadingIcon ? (
          <View style={styles.iconFrame} pointerEvents="none">
            {leadingIcon}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function createStyles(theme: AppTheme, height: number) {
  const iconSize = height - 12;

  return StyleSheet.create({
    shell: {
      height,
      borderRadius: height / 2,
    },
    shellGlow: theme.shadows.glow,
    clip: {
      flex: 1,
      borderRadius: height / 2,
      overflow: 'hidden',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.glass.strokeColor,
      justifyContent: 'center',
    },
    labelLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconFrame: {
      position: 'absolute',
      left: 6,
      top: 6,
      width: iconSize,
      height: iconSize,
      borderRadius: iconSize / 2,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
