import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
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

/**
 * `advance` sweeps the leading icon across the button and fades the label out
 * before `onPress` fires, so the transition reads as moving forward.
 */
export type AppButtonPressEffect = 'none' | 'advance';

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
  pressEffect?: AppButtonPressEffect;
  style?: StyleProp<ViewStyle>;
}

const ADVANCE_DURATION_MS = 420;
/** Long enough for the outgoing screen to be covered before the button resets. */
const ADVANCE_RESET_DELAY_MS = 650;

const ICON_INSET = 6;

export function AppButton({
  title,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled = false,
  height = 56,
  labelVariant = 'button',
  pressEffect = 'none',
  style,
  onPress,
  ...rest
}: AppButtonProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);

  // Lazy state rather than a ref: stable across renders, and readable during
  // render without tripping the rules of React.
  const [advance] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;
  const animates = pressEffect === 'advance' && Boolean(leadingIcon);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (!animates || width === 0) {
        onPress?.(event);
        return;
      }

      advance.setValue(0);
      Animated.timing(advance, {
        toValue: 1,
        duration: ADVANCE_DURATION_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (!finished) {
          return;
        }

        onPress?.(event);

        // Settle back once the next screen has covered this one, so returning
        // to the screen never shows the button mid-sweep.
        resetTimer.current = setTimeout(() => advance.setValue(0), ADVANCE_RESET_DELAY_MS);
      });
    },
    [animates, width, advance, onPress],
  );

  const iconSize = height - ICON_INSET * 2;
  const travel = Math.max(0, width - iconSize - ICON_INSET * 2);

  const iconTransform = animates
    ? [
        {
          translateX: advance.interpolate({
            inputRange: [0, 1],
            outputRange: [0, travel],
          }),
        },
      ]
    : undefined;

  const labelOpacity = animates
    ? advance.interpolate({
        inputRange: [0, 0.45],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      })
    : 1;

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      onLayout={onLayout}
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
        <Animated.View style={[styles.labelLayer, { opacity: labelOpacity }]} pointerEvents="none">
          {loading ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <AppText variant={labelVariant}>{title}</AppText>
          )}
        </Animated.View>

        {leadingIcon ? (
          <Animated.View
            style={[styles.iconFrame, iconTransform ? { transform: iconTransform } : null]}
            pointerEvents="none"
          >
            {leadingIcon}
          </Animated.View>
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
  const iconSize = height - ICON_INSET * 2;

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
      left: ICON_INSET,
      top: ICON_INSET,
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
