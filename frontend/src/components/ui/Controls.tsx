import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

/* ------------------------------------------------------------ Chips */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** A second line, e.g. "Recommended" or a reason it is unavailable. */
  detail?: string;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface ChipGroupProps<T extends string> {
  label?: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Scrolls sideways instead of wrapping, for long runs such as dates. */
  scroll?: boolean;
  /** One row of equal, compact segments that always fit, e.g. a map's level tabs. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A single-choice row of glass chips. The chosen chip takes the neon edge,
 * the rest sit dark, as Smart Home's filter chips do.
 */
export function ChipGroup<T extends string>({ label, options, value, onChange, scroll, fill, style }: ChipGroupProps<T>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const chips = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        onPress={() => onChange(option.value)}
        disabled={option.disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: option.disabled }}
        accessibilityLabel={[option.label, option.detail].filter(Boolean).join(', ')}
        style={({ pressed }) => [fill && styles.fillItem, pressed && styles.pressed, option.disabled && styles.disabled]}
      >
        <GlassSurface
          radius={theme.borderRadius.sm}
          glow={selected}
          stroke="gradient"
          strokeColors={
            selected
              ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
              : [theme.colors.dividerSubtle, theme.colors.dividerSubtle]
          }
          blurred={false}
          fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
          style={[styles.chip, fill && styles.chipFill, !selected && styles.chipIdle]}
        >
          {option.icon ? <Ionicons name={option.icon} size={fill ? 12 : 15} color={theme.colors.textPrimary} /> : null}
          <View style={fill && styles.fillText}>
            <AppText
              variant={fill ? (selected ? 'bodyStrong' : 'label') : selected ? 'bodyStrong' : 'caption'}
              style={fill && styles.fillLabel}
              numberOfLines={1}
            >
              {option.label}
            </AppText>
            {option.detail ? (
              <AppText variant="label" color={theme.colors.textSupport} numberOfLines={1}>
                {option.detail}
              </AppText>
            ) : null}
          </View>
        </GlassSurface>
      </Pressable>
    );
  });

  return (
    <View style={style} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? (
        <AppText variant="label" color={theme.colors.textSupport} style={styles.groupLabel}>
          {label}
        </AppText>
      ) : null}
      {fill ? (
        <View style={[styles.row, styles.rowFill]}>{chips}</View>
      ) : scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {chips}
        </ScrollView>
      ) : (
        <View style={[styles.row, styles.wrap]}>{chips}</View>
      )}
    </View>
  );
}

/* ------------------------------------------------------- Segmented */

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * One rounded track split into equal segments, the chosen one lit with the
 * app's blue gradient: for switching views of the same thing, such as a
 * map's levels.
 */
export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, style }: SegmentedProps<T>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.segTrack, style]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [styles.segItem, pressed && styles.pressed]}
          >
            {selected ? (
              <LinearGradient
                colors={[theme.colors.ctaSky, theme.colors.ctaRoyal]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.segGlow]}
              />
            ) : null}
            <AppText variant={selected ? 'bodyStrong' : 'caption'} color={selected ? theme.colors.textPrimary : theme.colors.textSecondary} numberOfLines={1} style={styles.segLabel}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------- Time stepper */

export interface StepperProps {
  label: string;
  /** Formatted value, e.g. "02:30 PM". */
  display: string;
  /** e.g. "3h stay" or "next day". */
  detail?: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A value with − and + either side: quicker on a phone than a long list of times. */
export function Stepper({
  label,
  display,
  detail,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
  style,
}: StepperProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const button = (icon: 'remove' | 'add', onPress: () => void, enabled: boolean, a11y: string) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, !enabled && styles.disabled]}
    >
      <Ionicons name={icon} size={20} color={theme.colors.textPrimary} />
    </Pressable>
  );

  return (
    <View style={style}>
      <AppText variant="label" color={theme.colors.textSupport} style={styles.groupLabel}>
        {label}
      </AppText>
      <View style={styles.stepper} accessible={false}>
        {button('remove', onDecrement, canDecrement, `Earlier ${label.toLowerCase()}`)}
        <View style={styles.stepValue} accessible accessibilityLabel={`${label}: ${display}${detail ? `, ${detail}` : ''}`}>
          <AppText variant="subheading">{display}</AppText>
          {detail ? (
            <AppText variant="label" color={theme.colors.textSupport}>
              {detail}
            </AppText>
          ) : null}
        </View>
        {button('add', onIncrement, canIncrement, `Later ${label.toLowerCase()}`)}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ Field */

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/** A labelled text field, darker than its card, sized for comfortable typing. */
export function Field({ label, error, hint, icon, style, ...input }: FieldProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={style}>
      <AppText variant="label" color={theme.colors.textSupport} style={styles.groupLabel}>
        {label}
      </AppText>
      <View style={[styles.field, error ? styles.fieldError : null]}>
        {icon ? <Ionicons name={icon} size={17} color={theme.colors.textSupport} /> : null}
        <TextInput
          {...input}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.placeholder}
          selectionColor={theme.colors.accent}
          underlineColorAndroid={theme.colors.transparent}
          style={styles.input}
        />
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

/* ------------------------------------------------------------ Toggle row */

export interface CheckRowProps {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** A tappable row with a check box, e.g. "Visitor will add vehicle details". */
export function CheckRow({ label, detail, checked, onChange }: CheckRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? theme.colors.accent : theme.colors.textSupport}
      />
      <View style={styles.checkText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {detail ? (
          <AppText variant="label" color={theme.colors.textSupport}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------ Info row */

export interface InfoRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: ReactNode;
  /** Extra line under the value. */
  detail?: string;
}

/** Icon, caption and value: one fact about a booking. */
export function InfoRow({ icon, label, value, detail }: InfoRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoBadge}>
        <Ionicons name={icon} size={17} color={theme.colors.textPrimary} />
      </View>
      <View style={styles.infoText}>
        <AppText variant="label" color={theme.colors.textSupport}>
          {label}
        </AppText>
        {typeof value === 'string' ? <AppText variant="bodyStrong">{value}</AppText> : value}
        {detail ? (
          <AppText variant="label" color={theme.colors.textMuted}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ Fact grid */

export interface Fact {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  detail?: string;
  /** Takes the full row, e.g. a date range. */
  wide?: boolean;
}

/** Key facts two to a row, so a booking's essentials fit in one glance. */
export function FactGrid({ facts }: { facts: readonly Fact[] }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.grid}>
      {facts.map((fact) => (
        <View
          key={fact.label}
          style={[styles.fact, fact.wide && styles.factWide]}
          accessible
          accessibilityLabel={[fact.label, fact.value, fact.detail].filter(Boolean).join(', ')}
        >
          <View style={styles.factHead}>
            <Ionicons name={fact.icon} size={13} color={theme.colors.textSupport} />
            <AppText variant="label" color={theme.colors.textSupport} numberOfLines={1}>
              {fact.label}
            </AppText>
          </View>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {fact.value}
          </AppText>
          {fact.detail ? (
            <AppText variant="label" color={theme.colors.textMuted} numberOfLines={2}>
              {fact.detail}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.4,
    },
    segTrack: {
      flexDirection: 'row',
      padding: 3,
      gap: 3,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    segItem: {
      flex: 1,
      minHeight: 38,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden',
    },
    segGlow: {
      borderRadius: theme.borderRadius.sm,
      shadowColor: theme.colors.ctaSky,
      shadowOpacity: 0.6,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
    },
    segLabel: {
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
    },
    groupLabel: {
      marginBottom: 6,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    wrap: {
      flexWrap: 'wrap',
    },
    rowFill: {
      gap: 6,
    },
    chip: {
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    chipIdle: {
      backgroundColor: theme.colors.fieldFill,
    },
    fillItem: {
      flex: 1,
    },
    chipFill: {
      minHeight: 38,
      paddingHorizontal: 4,
      gap: 4,
      justifyContent: 'center',
    },
    fillText: {
      flexShrink: 1,
    },
    fillLabel: {
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
    },

    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      padding: 4,
    },
    stepButton: {
      width: 44,
      height: 44,
      borderRadius: theme.borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceSubtle,
    },
    stepValue: {
      flex: 1,
      alignItems: 'center',
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
    input: {
      ...theme.typography.bodyStrong,
      flex: 1,
      color: theme.colors.textPrimary,
      paddingVertical: 10,
      backgroundColor: theme.colors.transparent,
      borderWidth: 0,
    },
    below: {
      marginTop: 4,
    },

    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 4,
    },
    checkText: {
      flex: 1,
    },

    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    infoBadge: {
      width: 34,
      height: 34,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoText: {
      flex: 1,
      gap: 1,
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    fact: {
      flexGrow: 1,
      flexBasis: '45%',
      gap: 2,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
    },
    factWide: {
      flexBasis: '100%',
    },
    factHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
  });
}
