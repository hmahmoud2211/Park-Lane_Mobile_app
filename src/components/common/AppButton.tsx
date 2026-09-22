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
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';

export type AppButtonVariant = 'primary' | 'secondary';

export interface AppButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: AppButtonVariant;
  /** Rendered in a circular frame inset at the leading edge. */
  leadingIcon?: ReactNode;
  /** Rendered bare at the trailing edge, as on the login screen's Sign in. */
  trailingIcon?: ReactNode;
  loading?: boolean;
  height?: number;
  /** Overrides the label style; defaults to the `button` typography variant. */
  labelVariant?: TypographyVariant;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  title,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled = false,
  height = 56,
  labelVariant = 'button',
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
      // Keeps the tap target at least 44dp tall on the shorter login button.
      hitSlop={Math.max(0, Math.ceil((44 - height) / 2))}
      style={({ pressed }) => [
        styles.shell,
        isPrimary && styles.shellGlow,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <GlassSurface radius={height / 2} tinted={isPrimary} style={styles.surface}>
        {/* Centred on the button itself, so a side icon never shifts it. */}
        <View style={styles.labelLayer} pointerEvents="none">
          {loading ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <AppText variant={labelVariant}>{title}</AppText>
          )}
        </View>

        {leadingIcon ? (
          <View style={styles.iconFrame} pointerEvents="none">
            {leadingIcon}
          </View>
        ) : null}

        {trailingIcon ? (
          <View style={styles.trailingIcon} pointerEvents="none">
            {trailingIcon}
          </View>
        ) : null}
      </GlassSurface>
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
    surface: {
      flex: 1,
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
    trailingIcon: {
      position: 'absolute',
      right: theme.spacing.lg,
      top: 0,
      bottom: 0,
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
