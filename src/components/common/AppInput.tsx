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

/**
 * `pill` is the login field. `field` is the compact form field from the
 * Visitor Access design (assets/Screens/screen5.png): a rounded rectangle
 * darker than its card, a faint hairline, no divider after the icon, and
 * smaller type.
 */
export type AppInputVariant = 'pill' | 'field';

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
  variant?: AppInputVariant;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** `field` variant measurements, from the Visitor Access reference. */
const FIELD_RADIUS = 5;
/** Centres the icon 17dp in and starts the text 38dp in. */
const FIELD_ICON_COLUMN = 34.5;
const FIELD_TEXT_INSET = 3.5;
const FIELD_TRAILING_INSET = 7;

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
    variant = 'pill',
    containerStyle,
    inputStyle,
    ...rest
  },
  ref,
) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);
  const isField = variant === 'field';

  return (
    <View style={containerStyle}>
      <GlassSurface
        radius={isField ? FIELD_RADIUS : height / 2}
        // The field sits on a glass card, so it takes a flat fill of its own
        // rather than a second blur and tint (see GlassSurface `blurred`).
        tinted={!isField}
        blurred={!isField}
        style={[styles.surface, isField && styles.fieldSurface]}
      >
        {leftIcon ? (
          <View style={[styles.iconColumn, isField && styles.fieldIconColumn]}>
            {leftIcon}
            {isField ? null : <View style={styles.iconDivider} />}
          </View>
        ) : null}

        <View style={[styles.body, isField && styles.fieldBody]}>
          {label ? (
            <AppText
              variant={isField ? 'fieldCaption' : 'inputLabel'}
              color={theme.colors.inputLabel}
            >
              {label}
            </AppText>
          ) : null}
          <TextInput
            {...rest}
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            placeholderTextColor={isField ? theme.colors.textSupport : theme.colors.placeholder}
            selectionColor={theme.colors.accent}
            underlineColorAndroid={theme.colors.transparent}
            style={[
              styles.input,
              isField && styles.fieldInput,
              // The design sets placeholders in the regular cut, values in medium.
              isField && !value && styles.fieldInputEmpty,
              inputStyle,
            ]}
          />
        </View>

        {rightIcon ? (
          <View style={[styles.rightIcon, isField && styles.fieldRightIcon]}>{rightIcon}</View>
        ) : null}
      </GlassSurface>

      {error ? (
        <AppText
          variant={isField ? 'fieldCaption' : 'bodySmall'}
          color={theme.colors.magenta}
          style={[styles.error, isField && styles.fieldError]}
        >
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

    fieldSurface: {
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    fieldIconColumn: {
      width: FIELD_ICON_COLUMN,
    },
    // The label and value sit 1dp below centre, as drawn.
    fieldBody: {
      paddingLeft: FIELD_TEXT_INSET,
      paddingRight: theme.spacing.xs,
      paddingTop: 2,
    },
    fieldInput: {
      ...theme.typography.fieldValue,
      marginTop: 2,
    },
    fieldInputEmpty: {
      fontFamily: theme.fontFamily.regular,
    },
    fieldRightIcon: {
      paddingLeft: theme.spacing.xs,
      paddingRight: FIELD_TRAILING_INSET,
    },
    fieldError: {
      marginTop: 3,
      marginLeft: theme.spacing.xs,
    },
  });
}
