import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
// Visitor Access's form sizes, so the app's forms read as one.
import { FIELD_CHEVRON_SIZE, FIELD_HEIGHT, FORM_ICON_SIZE } from '../../components/forms/formMetrics';
import type { AmenitySlot } from '../../../../shared/contracts/amenities';
import { getAmenitySlots } from '../../features/amenities/services/amenitiesApi';
import {
  amenitiesCopy as copy,
  labelFor,
  peopleChoices,
  slotChoices,
  validateBooking,
  type Amenity,
  type BookingErrors,
  type BookingForm as BookingValues,
  type Choice,
} from './AmenitiesBookingScreen.data';
import { FormSubmitButton } from '../../components/forms/FormSubmitButton';

export interface BookingFormProps {
  amenity: Amenity;
  /** The days that can be booked. */
  dates: readonly Choice[];
  /**
   * Books a form that passed the app's checks. Resolves with what went wrong, if anything: a refused field (shown
   * beside it; the day's times are reloaded) or a message.
   */
  onSubmit: (form: BookingValues) => Promise<BookingErrors | string | null>;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

type SelectKey = keyof BookingValues;

/** Which list is open, and the field it hangs from. */
interface OpenSelect {
  key: SelectKey;
  anchor: { x: number; y: number; width: number; height: number };
  align: 'left' | 'right';
}

interface SelectField {
  key: SelectKey;
  label: string;
  placeholder: string;
  iconName: keyof typeof Ionicons.glyphMap;
  iconSize: number;
}

/** Date and time side by side, then the party size: Visitor Access's grid. */
const FIELD_ROWS: readonly (readonly SelectField[])[] = [
  [
    {
      key: 'date',
      label: copy.dateLabel,
      placeholder: copy.datePlaceholder,
      iconName: 'calendar-outline',
      iconSize: 16,
    },
    {
      key: 'slot',
      label: copy.slotLabel,
      placeholder: copy.slotPlaceholder,
      iconName: 'time-outline',
      iconSize: 17,
    },
  ],
  [
    {
      key: 'people',
      label: copy.peopleLabel,
      placeholder: '',
      iconName: 'people-outline',
      iconSize: 17,
    },
  ],
];

/* The layout of the app's other forms (Visitor Access, Maintenance). */
const FORM_INSET = 12;
const FORM_TOP = 14;
const FORM_BOTTOM = 14;
const HEADER_TO_FIELDS = 14;
const FIELD_GAP = 10;
const CTA_TOP = 16;
const CLOSE_ICON_SIZE = 16;

/** Books one amenity: a day, one of its free times that day, and how many are coming. */
export function BookingForm({ amenity, dates, onSubmit, onClose, style }: BookingFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [form, setForm] = useState<BookingValues>({ date: '', slot: '', people: '1' });
  const [errors, setErrors] = useState<BookingErrors>({});
  const [open, setOpen] = useState<OpenSelect | null>(null);
  const [slots, setSlots] = useState<readonly AmenitySlot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const refs = useRef<Partial<Record<SelectKey, ViewInstance | null>>>({});
  /** Only the answer for the day last chosen counts. */
  const slotsFor = useRef('');

  const options: Record<SelectKey, readonly Choice[]> = {
    date: dates,
    slot: slots ? slotChoices(slots, amenity, Number(form.people)) : [],
    people: peopleChoices(amenity),
  };

  const loadSlots = (date: string) => {
    slotsFor.current = date;
    setSlots(null);
    getAmenitySlots(amenity.id, date)
      .then((loaded) => {
        if (slotsFor.current === date) setSlots(loaded);
      })
      .catch(() => {
        if (slotsFor.current === date) setSlots([]);
      });
  };

  const update = (key: SelectKey, value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // A new day (or a bigger party) can rule out the chosen time.
      if (key !== 'slot') next.slot = key === 'people' && slots && slotChoices(slots, amenity, Number(value)).some((choice) => choice.value === current.slot) ? current.slot : '';
      return next;
    });
    if (key === 'date') loadSlots(value);
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const openSelect = (key: SelectKey, column: number) => {
    Keyboard.dismiss();
    refs.current[key]?.measureInWindow((x, y, width, height) =>
      setOpen({ key, anchor: { x, y, width, height }, align: column === 0 ? 'left' : 'right' }),
    );
  };

  const submit = () => {
    if (busy) return;
    const found = validateBooking(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy(true);
    setFailure(null);
    onSubmit(form)
      .then((problem) => {
        if (typeof problem === 'string') setFailure(problem);
        else if (problem) {
          setErrors(problem);
          // Someone may have just taken the time: show what is left.
          if (problem.slot) {
            setForm((current) => ({ ...current, slot: '' }));
            loadSlots(form.date);
          }
        }
      })
      .finally(() => setBusy(false));
  };

  const emptyLabel = open?.key === 'slot' ? (!form.date ? copy.chooseDayFirst : slots === null ? copy.loadingSlots : copy.noSlots) : copy.noSlots;
  const menuItems: readonly AppMenuItem[] = open
    ? options[open.key].length > 0
      ? options[open.key].map((choice) => ({
          id: choice.value,
          label: choice.label,
          onPress: () => {
            update(open.key, choice.value);
            setOpen(null);
          },
        }))
      : [{ id: 'none', label: emptyLabel, onPress: () => setOpen(null) }]
    : [];

  return (
    <NeonPanel style={[styles.panel, style]}>
      <View style={styles.header}>
        <AppIcon set={amenity.iconSet} name={amenity.iconName} size={FORM_ICON_SIZE} />
        <View style={styles.title}>
          <AppText variant="sectionTitle" accessibilityRole="header">
            {copy.formTitle(amenity.title)}
          </AppText>
          <AppText variant="statLabel" color={theme.colors.textSupport} style={styles.subtitle}>
            {copy.formSubtitle}
          </AppText>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={copy.closeForm}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="close" size={CLOSE_ICON_SIZE} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.grid}>
        {FIELD_ROWS.map((row) => (
          <View key={row[0].key} style={styles.row}>
            {row.map((field, column) => (
              <Pressable
                key={field.key}
                ref={(node) => {
                  refs.current[field.key] = node;
                }}
                onPress={() => openSelect(field.key, column)}
                accessibilityRole="button"
                accessibilityLabel={`${field.label}: ${labelFor(options[field.key], form[field.key]) || field.placeholder}`}
                accessibilityHint="Opens a list of choices"
                style={({ pressed }) => [styles.field, pressed && styles.pressed]}
              >
                {/* Display only: the whole field is the button, not the input. */}
                <View pointerEvents="none">
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={field.label}
                    value={labelFor(options[field.key], form[field.key]) || (field.key === 'slot' && form.slot ? form.slot : '')}
                    onChangeText={() => undefined}
                    placeholder={field.placeholder}
                    editable={false}
                    leftIcon={
                      <Ionicons
                        name={field.iconName}
                        size={field.iconSize}
                        color={theme.colors.textPrimary}
                      />
                    }
                    rightIcon={
                      <Ionicons
                        name="chevron-down"
                        size={FIELD_CHEVRON_SIZE}
                        color={theme.colors.textPrimary}
                      />
                    }
                    error={errors[field.key]}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <FormSubmitButton title={busy ? copy.confirming : copy.confirm} onPress={submit} style={styles.cta} />
      {failure ? (
        <AppText variant="statLabel" color={theme.colors.error} accessibilityRole="alert" style={styles.failure}>
          {failure}
        </AppText>
      ) : null}

      <AppMenu
        visible={open !== null}
        onClose={() => setOpen(null)}
        items={menuItems}
        anchor={open?.anchor}
        align={open?.align}
        selectedId={open ? form[open.key] || undefined : undefined}
      />
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    panel: {
      paddingHorizontal: FORM_INSET,
      paddingTop: FORM_TOP,
      paddingBottom: FORM_BOTTOM,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: HEADER_TO_FIELDS,
      paddingLeft: 4,
      paddingRight: 2,
    },
    title: {
      flex: 1,
      marginLeft: 10,
      marginRight: theme.spacing.sm,
    },
    subtitle: {
      marginTop: 1.5,
    },
    grid: {
      gap: FIELD_GAP,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: FIELD_GAP,
    },
    field: {
      flex: 1,
    },
    cta: {
      marginTop: CTA_TOP,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      ...theme.shadows.glow,
    },
    failure: {
      marginTop: theme.spacing.sm,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
