import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { Notice } from '../../components/parking/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { FlowField, FlowStep } from '../../types/home.types';
import { connectCopy as copy } from './ConnectAccountScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, QR_SIZE, createStyles } from './ConnectAccountScreen.styles';

export interface FlowStepFormProps {
  step: FlowStep;
  brand: string;
  busy: boolean;
  error: string | null;
  onSubmit: (data: Record<string, unknown>) => void;
  onSignIn: () => void;
  onCancel: () => void;
  onDone: () => void;
  onRetry: () => void;
}

/** Text the resident types: everything a form starts with, as strings, so inputs stay controlled. */
function initialValues(fields: readonly FlowField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind === 'boolean') values[field.name] = field.default === true;
    else if (field.kind === 'select') values[field.name] = field.multiple ? (Array.isArray(field.default) ? field.default : []) : (field.default ?? null);
    else if (field.kind !== 'qr' && field.kind !== 'constant') values[field.name] = field.default === undefined || field.default === null ? '' : String(field.default);
  }
  return values;
}

/**
 * One step of linking a brand account, whatever the brand asks for: a form
 * (fields from the backend, labelled), a QR code to scan, a choice, its own
 * sign-in page, a wait, or the result. Remount it per step (key it) so a new
 * step starts with fresh values.
 */
export function FlowStepForm({ step, brand, busy, error, onSubmit, onSignIn, onCancel, onDone, onRetry }: FlowStepFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [values, setValues] = useState(() => initialValues(step.fields));
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const set = (name: string, value: unknown) => setValues((current) => ({ ...current, [name]: value }));

  const submit = () => {
    const problems: Record<string, string> = {};
    for (const field of step.fields) {
      const value = values[field.name];
      if (field.kind === 'boolean' || field.kind === 'qr' || field.kind === 'constant') continue;
      if (field.required && (value === '' || value === null || (Array.isArray(value) && value.length === 0))) {
        problems[field.name] = copy.required;
      } else if (field.kind === 'number' && value !== '' && !Number.isFinite(Number(value))) {
        problems[field.name] = copy.notANumber;
      }
    }
    setInvalid(problems);
    if (Object.keys(problems).length > 0) {
      return;
    }
    const data: Record<string, unknown> = {};
    for (const field of step.fields) {
      const value = values[field.name];
      if (field.kind === 'qr' || field.kind === 'constant' || value === undefined) continue;
      if (field.kind === 'number') {
        if (value !== '') data[field.name] = Number(value);
      } else if (value !== '' || field.required) {
        data[field.name] = value;
      }
    }
    onSubmit(data);
  };

  const cancel = step.type !== 'done' ? <AppButton title={copy.cancel} variant="secondary" height={BUTTON_HEIGHT} onPress={onCancel} disabled={busy} /> : null;
  const heading = (
    <>
      {step.title ? <AppText variant="bodyStrong">{step.title}</AppText> : null}
      {step.description ? (
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {step.description}
        </AppText>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );

  switch (step.type) {
    case 'done':
      return (
        <View style={styles.form}>
          <Notice tone="success" title={copy.linkedTitle}>
            {step.title ? `${step.title}. ${copy.linkedBody}` : copy.linkedBody}
          </Notice>
          <AppButton title={copy.done} variant="gradient" height={BUTTON_HEIGHT} onPress={onDone} />
        </View>
      );
    case 'abort':
      return (
        <View style={styles.form}>
          <Notice tone="error" title={copy.failedTitle}>
            {step.message ?? ''}
          </Notice>
          <AppButton title={copy.startOver} variant="gradient" height={BUTTON_HEIGHT} onPress={onRetry} />
          {cancel}
        </View>
      );
    case 'progress':
      return (
        <View style={styles.form}>
          {heading}
          <View style={styles.center} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.colors.textPrimary} />
            <AppText variant="bodySmall" color={theme.colors.textSupport} align="center">
              {step.message ?? copy.working}
            </AppText>
          </View>
          {cancel}
        </View>
      );
    case 'external':
      return (
        <View style={styles.form}>
          {heading}
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.externalIntro(brand)}
          </AppText>
          <AppButton title={copy.signIn(brand)} variant="gradient" height={BUTTON_HEIGHT} loading={busy} disabled={busy || !step.url} onPress={onSignIn} />
          {cancel}
        </View>
      );
    case 'menu':
      return (
        <View style={styles.form}>
          {heading}
          {step.menu.map((option) => (
            <AppButton
              key={option.id}
              title={option.label}
              variant="secondary"
              height={BUTTON_HEIGHT}
              disabled={busy}
              onPress={() => onSubmit({ next_step_id: option.id })}
            />
          ))}
          {cancel}
        </View>
      );
    default:
      break;
  }

  return (
    <View style={styles.form}>
      {heading}
      {step.errors.base ? <Notice tone="error">{step.errors.base}</Notice> : null}
      {step.fields.map((field) => {
        const fieldError = invalid[field.name] ?? step.errors[field.name];
        switch (field.kind) {
          case 'qr':
            return field.data ? (
              <View key={field.name} style={styles.form}>
                <View style={styles.qr} accessible accessibilityLabel="QR code to scan with the brand's app">
                  <QRCode value={field.data} size={QR_SIZE} color={theme.colors.qrForeground} backgroundColor={theme.colors.qrBackground} ecl="Q" />
                </View>
                <AppText variant="tileCaption" color={theme.colors.textSupport} align="center">
                  {copy.qrHint}
                </AppText>
              </View>
            ) : null;
          case 'constant':
            return (
              <AppText key={field.name} variant="bodySmall">
                {field.data ?? field.label}
              </AppText>
            );
          case 'boolean':
            return (
              <View key={field.name} style={styles.toggleRow}>
                <AppText variant="statValue" style={styles.flex}>
                  {field.label}
                </AppText>
                <ToggleSwitch value={values[field.name] === true} onValueChange={(next) => set(field.name, next)} accessibilityLabel={field.label} />
              </View>
            );
          case 'select': {
            const selected = values[field.name];
            const isSelected = (value: string) => (Array.isArray(selected) ? selected.includes(value) : selected === value);
            return (
              <View key={field.name} style={styles.form}>
                <AppText variant="statLabel" color={theme.colors.textSupport}>
                  {field.label}
                </AppText>
                <View style={styles.chips} accessibilityRole={field.multiple ? undefined : 'radiogroup'}>
                  {field.options.map((option) => (
                    <FilterChip
                      key={option.value}
                      role="radio"
                      label={option.label}
                      iconSet="ionicons"
                      iconName={isSelected(option.value) ? 'checkmark-circle' : 'ellipse-outline'}
                      selected={isSelected(option.value)}
                      onPress={() =>
                        set(
                          field.name,
                          field.multiple
                            ? isSelected(option.value)
                              ? (selected as string[]).filter((value) => value !== option.value)
                              : [...((selected as string[]) ?? []), option.value]
                            : option.value,
                        )
                      }
                    />
                  ))}
                </View>
                {fieldError ? (
                  <AppText variant="tileCaption" color={theme.colors.error}>
                    {fieldError}
                  </AppText>
                ) : null}
              </View>
            );
          }
          default:
            return (
              <View key={field.name}>
                <AppInput
                  variant="field"
                  label={field.label}
                  value={String(values[field.name] ?? '')}
                  onChangeText={(text) => set(field.name, text)}
                  secureTextEntry={field.kind === 'password'}
                  keyboardType={field.kind === 'email' ? 'email-address' : field.kind === 'number' ? 'numeric' : 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={field.multiline}
                  height={FIELD_HEIGHT}
                  error={fieldError}
                />
                {field.description ? (
                  <AppText variant="tileCaption" color={theme.colors.textSupport}>
                    {field.description}
                  </AppText>
                ) : null}
              </View>
            );
        }
      })}
      <AppButton title={copy.continue} variant="gradient" height={BUTTON_HEIGHT} loading={busy} disabled={busy} onPress={submit} />
      {cancel}
    </View>
  );
}
