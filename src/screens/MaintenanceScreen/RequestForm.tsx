import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
// Visitor Access's form sizes, so the app's two forms read as one.
import {
  CTA_ARROW_SIZE,
  CTA_HEIGHT,
  FIELD_CHEVRON_SIZE,
  FIELD_HEIGHT,
  FORM_ICON_SIZE,
} from '../VisitorAccessScreen/VisitorAccessScreen.styles';
import {
  emptyRequestForm,
  maintenanceCopy as copy,
  requestFieldRows,
  serviceCategories,
  validateRequest,
  visitDateOptions,
  visitWindows,
  type RequestFieldConfig,
  type RequestForm as RequestFormValues,
  type RequestFormErrors,
  type RequestFormKey,
} from './MaintenanceScreen.data';

export interface RequestFormProps {
  /** Fills in the category, e.g. when the form was opened from its tile. */
  categoryTitle?: string;
  /** Receives a form that passed validation. */
  onSubmit: (form: RequestFormValues) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

type SelectKey = Extract<RequestFormKey, 'category' | 'date' | 'window'>;

interface OpenSelect {
  key: SelectKey;
  anchor: { x: number; y: number; width: number; height: number };
  align: 'left' | 'right';
}

/* Visitor Access's form layout: the same insets, header and field grid. */
const FORM_INSET = 12;
const FORM_TOP = 14;
const FORM_BOTTOM = 14;
const HEADER_TO_FIELDS = 14;
const FIELD_GAP = 10;
const CTA_TOP = 16;
const CLOSE_ICON_SIZE = 16;

/**
 * The new maintenance request, built on Visitor Access's "New Visitor Pass"
 * form: text fields, fields that open a list of choices, and a gradient
 * submit button. The form keeps its own values; the screen only receives a
 * valid request.
 */
export function RequestForm({ categoryTitle, onSubmit, onClose, style }: RequestFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [form, setForm] = useState<RequestFormValues>(() => ({
    ...emptyRequestForm,
    category: categoryTitle ?? '',
  }));
  const [errors, setErrors] = useState<RequestFormErrors>({});
  const [openSelect, setOpenSelect] = useState<OpenSelect | null>(null);
  const selectRefs = useRef<Partial<Record<SelectKey, ViewInstance | null>>>({});

  // Another tile tapped while the form is open picks that category instead.
  // Adjusted during render, as React recommends for state that follows a prop.
  const [lastCategory, setLastCategory] = useState(categoryTitle);
  if (categoryTitle !== lastCategory) {
    setLastCategory(categoryTitle);
    if (categoryTitle) {
      setForm((current) => ({ ...current, category: categoryTitle }));
      setErrors((current) => ({ ...current, category: undefined }));
    }
  }

  const options = useMemo<Record<SelectKey, readonly string[]>>(
    () => ({
      category: serviceCategories.map((category) => category.title),
      date: visitDateOptions(),
      window: visitWindows,
    }),
    [],
  );

  const update = (key: RequestFormKey, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Editing a field clears its message; the rest wait for the next submit.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const open = (key: SelectKey, column: number) => {
    Keyboard.dismiss();
    selectRefs.current[key]?.measureInWindow((x, y, width, height) => {
      setOpenSelect({ key, anchor: { x, y, width, height }, align: column === 0 ? 'left' : 'right' });
    });
  };

  const submit = () => {
    Keyboard.dismiss();
    const found = validateRequest(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    onSubmit(form);
  };

  const menuItems: readonly AppMenuItem[] = openSelect
    ? options[openSelect.key].map((label) => ({
        id: label,
        label,
        onPress: () => {
          update(openSelect.key, label);
          setOpenSelect(null);
        },
      }))
    : [];

  const renderField = (field: RequestFieldConfig, column: number) => {
    const icon = <AppIcon set={field.iconSet} name={field.iconName} size={field.iconSize} />;

    if (field.kind === 'select') {
      const key = field.key as SelectKey;
      return (
        <Pressable
          key={key}
          ref={(node) => {
            selectRefs.current[key] = node;
          }}
          onPress={() => open(key, column)}
          accessibilityRole="button"
          accessibilityLabel={`${field.label}: ${form[key] || field.placeholder}`}
          accessibilityHint="Opens a list of choices"
          style={({ pressed }) => [styles.field, pressed && styles.pressed]}
        >
          {/* Display only: the whole field is the button, not the input. */}
          <View pointerEvents="none">
            <AppInput
              variant="field"
              height={FIELD_HEIGHT}
              label={field.label}
              value={form[key]}
              onChangeText={() => undefined}
              placeholder={field.placeholder}
              editable={false}
              leftIcon={icon}
              rightIcon={
                <Ionicons name="chevron-down" size={FIELD_CHEVRON_SIZE} color={theme.colors.textPrimary} />
              }
              error={errors[key]}
            />
          </View>
        </Pressable>
      );
    }

    return (
      <AppInput
        key={field.key}
        variant="field"
        height={FIELD_HEIGHT}
        containerStyle={styles.field}
        label={field.label}
        value={form[field.key]}
        onChangeText={(text) => update(field.key, text)}
        placeholder={field.placeholder}
        leftIcon={icon}
        error={errors[field.key]}
        autoCapitalize="sentences"
        maxLength={field.key === 'issue' ? 60 : 200}
        returnKeyType="done"
        accessibilityLabel={field.label}
      />
    );
  };

  return (
    <NeonPanel style={[styles.panel, style]}>
      <View style={styles.header}>
        <Ionicons name="construct-outline" size={FORM_ICON_SIZE} color={theme.colors.textPrimary} />
        <View style={styles.title}>
          <AppText variant="sectionTitle" accessibilityRole="header">
            {copy.formTitle}
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
        {requestFieldRows.map((row) => (
          <View key={row[0].key} style={styles.row}>
            {row.map((field, column) => renderField(field, column))}
          </View>
        ))}
      </View>

      <AppButton
        title={copy.submit}
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
        visible={openSelect !== null}
        onClose={() => setOpenSelect(null)}
        items={menuItems}
        anchor={openSelect?.anchor}
        align={openSelect?.align}
        selectedId={openSelect ? form[openSelect.key] || undefined : undefined}
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
      // The pale rim around the gradient, as on Visitor Access.
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      ...theme.shadows.glow,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
