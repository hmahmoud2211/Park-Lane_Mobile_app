import { createElement, useMemo, type ChangeEvent } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import type { TimeFieldProps } from './TimeField';

export { deviceTime } from './deviceTime';

/** Web: the browser's own time input, which already speaks `HH:mm`. Laid out like DateField.web.tsx. */
export function TimeField({ label, value, onChange, error }: TimeFieldProps) {
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
          type: 'time',
          value,
          'aria-label': label,
          // Clearing the input gives an empty value; the field always holds a time.
          onChange: (event: ChangeEvent<HTMLInputElement>) => event.target.value && onChange(event.target.value),
          style: inputStyle,
        })}
      </View>
      {error ? (
        <AppText variant="label" color={theme.colors.chipRedText} style={styles.below}>
          {error}
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
