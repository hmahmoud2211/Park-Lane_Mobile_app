import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { FieldSpec } from '../../types/gateway.types';
import type { AppTheme } from '../../types/theme.types';
import { AppInput } from '../common/AppInput';
import { AppText } from '../common/AppText';
import { FilterChip } from '../ui/FilterChip';

const FIELD_HEIGHT = 54;

/**
 * The inputs a pairing asks for (a Tuya local key, a Shelly password, a
 * Tapo account), from the gateway's FieldSpec list. Secret fields are masked
 * and never autofilled or autocorrected.
 */
export function CredentialFields({
  fields,
  values,
  onChange,
  errors = {},
}: {
  fields: readonly FieldSpec[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  errors?: Record<string, string>;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.root}>
      {fields.map((field) =>
        field.kind === 'select' ? (
          <View key={field.name} style={styles.group}>
            <AppText variant="statLabel" color={theme.colors.textSupport}>
              {field.label}
            </AppText>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {field.options.map((option) => (
                <FilterChip
                  key={option}
                  role="radio"
                  label={option}
                  iconSet="ionicons"
                  iconName="ellipse-outline"
                  selected={values[field.name] === option}
                  onPress={() => onChange(field.name, option)}
                />
              ))}
            </View>
          </View>
        ) : (
          <View key={field.name} style={styles.group}>
            <AppInput
              variant="field"
              label={field.required ? field.label : `${field.label} (optional)`}
              value={values[field.name] ?? ''}
              onChangeText={(text) => onChange(field.name, text)}
              secureTextEntry={field.secret || field.kind === 'password'}
              keyboardType={field.kind === 'number' ? 'number-pad' : 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType={field.secret ? 'oneTimeCode' : 'none'}
              error={errors[field.name]}
              height={FIELD_HEIGHT}
            />
            {field.help ? (
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {field.help}
              </AppText>
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}

/** Required fields left empty, by name. */
export function missingFields(fields: readonly FieldSpec[], values: Record<string, string>): Record<string, string> {
  const missing: Record<string, string> = {};
  for (const field of fields) {
    if (field.required && !(values[field.name] ?? '').trim()) {
      missing[field.name] = 'Required';
    }
  }
  return missing;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    group: {
      gap: theme.spacing.xs,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
  });
}
