import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { clock } from '../../services/clinic/presenters';
import type { AppTheme } from '../../types/theme.types';
import { DirectionView } from '../common/DirectionView';
import { Field } from '../parking/Controls';
import { ParkingButton } from '../parking/ParkingButton';
import { deviceTimeOf } from './deviceTime';

export { deviceTime } from './deviceTime';

export interface TimeFieldProps {
  label: string;
  /** `HH:mm`, in the device's time zone. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function dateOf(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Any hour and minute, chosen with the system picker: Android's clock
 * dialog, and on iOS a wheel in a sheet. Web uses the browser's time input
 * (TimeField.web.tsx), as this picker has no web version.
 */
export function TimeField({ label, value, onChange, error }: TimeFieldProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, t } = useHealth();
  const [draft, setDraft] = useState<Date | null>(null);

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: dateOf(value), mode: 'time', onValueChange: (_event, date) => onChange(deviceTimeOf(date)) });
    } else {
      setDraft(dateOf(value));
    }
  };

  const shown = clock(value, lang);

  return (
    <View>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}`} style={({ pressed }) => pressed && styles.pressed}>
        {/* The field is only the look; the press opens the picker. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Field label={label} value={shown} editable={false} icon="time-outline" error={error} />
        </View>
      </Pressable>

      {draft ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDraft(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDraft(null)} accessibilityLabel={t.actions.cancel}>
            <Pressable style={styles.panel} onPress={(event) => event.stopPropagation()}>
              <DirectionView direction={lang === 'ar' ? 'rtl' : 'ltr'} style={styles.content}>
                <DateTimePicker
                  value={draft}
                  mode="time"
                  display="spinner"
                  themeVariant="dark"
                  accentColor={theme.colors.accent}
                  locale={lang === 'ar' ? 'ar' : 'en'}
                  onValueChange={(_event, date) => setDraft(date)}
                />
                <ParkingButton
                  tone="primary"
                  label={t.done}
                  onPress={() => {
                    onChange(deviceTimeOf(draft));
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
