import { createElement, useMemo, type ChangeEvent } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { todayIso } from '../../services/health/selectors';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import type { DateFieldProps } from './DateField';

/**
 * Web: the browser's own date input, which shows the platform calendar and
 * already speaks `YYYY-MM-DD`. Laid out like the app's Field, from the same
 * tokens, with no icon of its own as the browser draws one; the input
 * clears itself, so `optional` needs no extra control.
 */
export function DateField({ label, value, onChange, error, hint, allowFuture = false, minimumDate }: DateFieldProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const inputStyle = useMemo(
    () => ({
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: theme.colors.textPrimary,
      fontFamily: theme.fontFamily.semiBold,
      fontSize: theme.typography.bodyStrong.fontSize,
      lineHeight: `${theme.typography.bodyStrong.lineHeight}px`,
      padding: `${theme.spacing.sm}px 0`,
      // Draws the browser's calendar popup dark, to match the app.
      colorScheme: 'dark',
    }),
    [theme],
  );

  return (
    <View>
      <AppText variant="label" color={theme.colors.textSupport} style={styles.label}>
        {label}
      </AppText>
      <View style={[styles.field, error ? styles.fieldError : null]}>
        {createElement('input', {
          type: 'date',
          value,
          max: allowFuture ? undefined : todayIso(),
          min: minimumDate,
          'aria-label': label,
          onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
          style: inputStyle,
        })}
      </View>
      {error ? (
        <AppText variant="label" color={theme.colors.chipRedText} style={styles.below}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="label" color={theme.colors.textMuted} style={styles.below}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    label: {
      marginBottom: 6,
    },
    field: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      paddingHorizontal: 12,
      gap: 8,
    },
    fieldError: {
      borderColor: theme.colors.errorStroke,
    },
    below: {
      marginTop: 4,
    },
  });
}
