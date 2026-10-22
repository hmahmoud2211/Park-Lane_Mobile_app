import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
// Visitor Access's form sizes, so the app's forms read as one.
import {
  CTA_ARROW_SIZE,
  CTA_HEIGHT,
  FIELD_CHEVRON_SIZE,
  FIELD_HEIGHT,
  FORM_ICON_SIZE,
} from '../VisitorAccessScreen/VisitorAccessScreen.styles';
import {
  amenitiesCopy as copy,
  bookingDates,
  guestOptions,
  slotOptions,
  validateBooking,
  type Amenity,
  type Booking,
  type BookingErrors,
  type BookingForm as BookingValues,
} from './AmenitiesBookingScreen.data';

export interface BookingFormProps {
  amenity: Amenity;
  /** The resident's bookings, so the same slot cannot be booked twice. */
  bookings: readonly Booking[];
  /** Receives a booking that passed validation. */
  onSubmit: (form: BookingValues) => void;
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
      key: 'guests',
      label: copy.guestsLabel,
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

/** Books one amenity: a day, a one-hour slot within its hours, and the party size. */
export function BookingForm({ amenity, bookings, onSubmit, onClose, style }: BookingFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [form, setForm] = useState<BookingValues>({ date: '', slot: '', guests: '1 Guest' });
  const [errors, setErrors] = useState<BookingErrors>({});
  const [open, setOpen] = useState<OpenSelect | null>(null);
  const refs = useRef<Partial<Record<SelectKey, View | null>>>({});

  const options: Record<SelectKey, readonly string[]> = {
    date: bookingDates(),
    // Until a day is chosen, the slots are the amenity's full hours.
    slot: slotOptions(amenity, form.date),
    guests: guestOptions(amenity),
  };

  const update = (key: SelectKey, value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // A new day can rule out the chosen time (e.g. one already past today).
      if (key === 'date' && next.slot && !slotOptions(amenity, value).includes(next.slot)) {
        next.slot = '';
      }
      return next;
    });
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const openSelect = (key: SelectKey, column: number) => {
    Keyboard.dismiss();
    refs.current[key]?.measureInWindow((x, y, width, height) =>
      setOpen({ key, anchor: { x, y, width, height }, align: column === 0 ? 'left' : 'right' }),
    );
  };

  const submit = () => {
    const found = validateBooking(form, amenity, bookings);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    onSubmit(form);
  };

  const menuItems: readonly AppMenuItem[] = open
    ? options[open.key].length > 0
      ? options[open.key].map((label) => ({
          id: label,
          label,
          onPress: () => {
            update(open.key, label);
            setOpen(null);
          },
        }))
      : [{ id: 'none', label: copy.noSlots, onPress: () => setOpen(null) }]
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
                accessibilityLabel={`${field.label}: ${form[field.key] || field.placeholder}`}
                accessibilityHint="Opens a list of choices"
                style={({ pressed }) => [styles.field, pressed && styles.pressed]}
              >
                {/* Display only: the whole field is the button, not the input. */}
                <View pointerEvents="none">
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={field.label}
                    value={form[field.key]}
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

      <AppButton
        title={copy.confirm}
        variant="gradient"
        gradientColors={[
          theme.colors.ctaSky,
          theme.colors.ctaRoyal,
          theme.colors.ctaViolet,
          theme.colors.ctaPink,
        ]}
        height={CTA_HEIGHT}
        labelVariant="statValue"
        trailingIcon={<ArrowRightIcon size={CTA_ARROW_SIZE} thickness={1.2} />}
        trailingPlacement="label"
        onPress={submit}
        style={styles.cta}
      />

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
    pressed: {
      opacity: 0.7,
    },
  });
}
