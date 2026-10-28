import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { formatDate } from '../../services/health/i18n';
import { dateFromIso, isoFromDate } from '../../services/health/selectors';
import type { AppTheme } from '../../types/theme.types';
import { DirectionView } from '../common/DirectionView';
import { Field } from '../parking/Controls';
import { ParkingButton } from '../parking/ParkingButton';
import { TextLink } from './TextLink';

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, or '' when no date is set. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  /** Off by default: most dates in a record are in the past. */
  allowFuture?: boolean;
  /** Earliest day that can be picked, `YYYY-MM-DD`; e.g. an end date after its start. */
  minimumDate?: string;
  /** Offers "Clear date" once a date is set. */
  optional?: boolean;
}

/**
 * A date chosen with the system picker and kept as `YYYY-MM-DD`: Android's
 * calendar dialog, and on iOS an inline calendar in a sheet. Shown in the
 * field in the reader's language. Web uses the browser's date input
 * (DateField.web.tsx), as this picker has no web version.
 */
export function DateField({ label, value, onChange, error, hint, allowFuture = false, minimumDate, optional = false }: DateFieldProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, t } = useHealth();
  const [draft, setDraft] = useState<Date | null>(null);

  const maximum = allowFuture ? undefined : new Date();
  const minimum = minimumDate ? dateFromIso(minimumDate) : undefined;
  const initial = () => {
    const start = value ? dateFromIso(value) : (maximum ?? new Date());
    if (minimum && start < minimum) return minimum;
    return start;
  };

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial(),
        mode: 'date',
        maximumDate: maximum,
        minimumDate: minimum,
        onValueChange: (_event, date) => onChange(isoFromDate(date)),
      });
    } else {
      setDraft(initial());
    }
  };

  const shown = value ? formatDate(value, lang) : '';

  return (
    <View>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown || t.pickDate}`}
        accessibilityHint={hint}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {/* The field is only the look; the press opens the picker. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Field
            label={label}
            value={shown}
            placeholder={t.pickDate}
            editable={false}
            icon="calendar-outline"
            error={error}
            hint={hint}
          />
        </View>
      </Pressable>
      {optional && value ? <TextLink label={t.clearDate} onPress={() => onChange('')} /> : null}

      {draft ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDraft(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDraft(null)} accessibilityLabel={t.actions.cancel}>
            <Pressable style={styles.panel} onPress={(event) => event.stopPropagation()}>
              <DirectionView direction={lang === 'ar' ? 'rtl' : 'ltr'} style={styles.content}>
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="inline"
                  themeVariant="dark"
                  accentColor={theme.colors.accent}
                  locale={lang === 'ar' ? 'ar' : 'en'}
                  maximumDate={maximum}
                  minimumDate={minimum}
                  onValueChange={(_event, date) => setDraft(date)}
                />
                <ParkingButton
                  tone="primary"
                  label={t.done}
                  onPress={() => {
                    onChange(isoFromDate(draft));
                    setDraft(null);
                  }}
                />
                <ParkingButton label={t.actions.cancel} onPress={() => setDraft(null)} />
              </DirectionView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    pressed: {
      opacity: 0.75,
    },
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.scrimBottom,
    },
    // A plain tinted panel, as in ConfirmSheet: glass buttons inside it would blur twice.
    panel: {
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.bubbleStroke,
      backgroundColor: theme.colors.cameraFill,
      overflow: 'hidden',
    },
    content: {
      padding: theme.spacing.md,
      gap: 8,
    },
  });
}
