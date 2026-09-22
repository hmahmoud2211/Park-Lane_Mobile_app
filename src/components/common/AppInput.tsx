import { forwardRef, useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';

export interface AppInputProps extends Omit<TextInputProps, 'style'> {
  /** Small caption above the value, inside the field. */
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Shown beneath the field once validation has run. */
  error?: string;
  /** Sits in a fixed column at the leading edge, separated by a hairline. */
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  height?: number;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * Glass text field matching the login design: a leading icon column divided by
 * a hairline, then a stacked label and value. Reusable for registration,
 * password recovery and profile screens.
 */
export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  {
    label,
    value,
    onChangeText,
    error,
    leftIcon,
    rightIcon,
    height = 56,
    containerStyle,
    inputStyle,
    ...rest
  },
  ref,
) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);

  return (
    <View style={containerStyle}>
      <GlassSurface radius={height / 2} style={styles.surface}>
        {leftIcon ? (
          <View style={styles.iconColumn}>
            {leftIcon}
            <View style={styles.iconDivider} />
          </View>
        ) : null}

        <View style={styles.body}>
          {label ? (
            <AppText variant="inputLabel" color={theme.colors.inputLabel}>
              {label}
            </AppText>
          ) : null}
          <TextInput
            {...rest}
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            placeholderTextColor={theme.colors.placeholder}
            selectionColor={theme.colors.accent}
            underlineColorAndroid={theme.colors.transparent}
            style={[styles.input, inputStyle]}
          />
        </View>

        {rightIcon ? <View style={styles.rightIcon}>{rightIcon}</View> : null}
      </GlassSurface>

      {error ? (
        <AppText variant="bodySmall" color={theme.colors.magenta} style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

function createStyles(theme: AppTheme, height: number) {
  return StyleSheet.create({
    surface: {
      height,
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconColumn: {
      width: height * 0.72,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconDivider: {
      position: 'absolute',
      right: 0,
      top: '22%',
      bottom: '22%',
      width: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.divider,
    },
    body: {
      flex: 1,
      justifyContent: 'center',
      paddingLeft: theme.spacing.md,
      paddingRight: theme.spacing.sm,
    },
    input: {
      ...theme.typography.inputValue,
      color: theme.colors.textPrimary,
      // The field's fill comes from the glass surface behind it, so the input
      // itself must not paint a background or border of its own.
      backgroundColor: theme.colors.transparent,
      borderWidth: 0,
      // Strips the default vertical padding so the label/value pair stays tight.
      padding: 0,
      margin: 0,
    },
    rightIcon: {
      paddingHorizontal: theme.spacing.md,
      height: '100%',
      justifyContent: 'center',
    },
    error: {
      marginTop: theme.spacing.xs,
      marginLeft: theme.spacing.md,
    },
  });
}
