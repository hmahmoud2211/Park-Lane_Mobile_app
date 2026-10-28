import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { FilterChip } from '../../components/ui/FilterChip';
import type { IconSet } from '../../components/ui/ServiceTile';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ControlSetting, ControlValue } from '../../types/ems.types';
import { acCopy } from './AcControlScreen.data';
import { ROW_ICON_SIZE, SMALL_STEP_ICON_SIZE, createStyles } from './AcControlScreen.styles';

function useStyles() {
  const theme = useAppTheme();
  return { theme, styles: useMemo(() => createStyles(theme), [theme]) };
}

/** Why the last change from this screen failed. */
export function ErrorLine({ error }: { error?: string }) {
  const { theme } = useStyles();
  return error ? (
    <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
      {error}
    </AppText>
  ) : null;
}

/** Rethink's descriptions start with the feature's name ("Jet: strong airflow…"), already shown above them. */
function withoutName(description: string): string {
  const rest = description.replace(/^[^:.]{1,40}:\s*/, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** A setting's name, what it does, and what it needs while the AC would ignore it. */
function RowText({ setting, error }: { setting: ControlSetting; error?: string }) {
  const { theme, styles } = useStyles();
  return (
    <View style={styles.rowText}>
      <AppText variant="statValue">{setting.name}</AppText>
      {setting.description ? (
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {withoutName(setting.description)}
        </AppText>
      ) : null}
      {!setting.available && setting.requires ? (
        <AppText variant="tileCaption" color={theme.colors.textAccentSoft}>
          {acCopy.needs(setting.requires)}
        </AppText>
      ) : null}
      <ErrorLine error={error} />
    </View>
  );
}

export interface ChoiceChipsProps {
  options: readonly string[];
  selected: ControlValue;
  disabled: boolean;
  onSelect: (option: string) => void;
  choice: (option: string) => { label: string; iconSet: IconSet; iconName: string };
}

/** A select setting as a row of chips, e.g. the mode or the fan speed. */
export function ChoiceChips({ options, selected, disabled, onSelect, choice }: ChoiceChipsProps) {
  const { styles } = useStyles();
  return (
    <View style={styles.choices} accessibilityRole="radiogroup">
      {options.map((option) => {
        const { label, iconSet, iconName } = choice(option);
        return (
          <FilterChip
            key={option}
            role="radio"
            label={label}
            iconSet={iconSet}
            iconName={iconName}
            selected={selected === option}
            disabled={disabled}
            onPress={() => onSelect(option)}
          />
        );
      })}
    </View>
  );
}

export interface SwitchRowProps {
  setting: ControlSetting;
  value: ControlValue;
  pending: boolean;
  error?: string;
  iconName: string;
  divider: boolean;
  onChange: (next: boolean) => void;
}

/** A feature switch, e.g. Jet or Air purify. */
export function SwitchRow({ setting, value, pending, error, iconName, divider, onChange }: SwitchRowProps) {
  const { theme, styles } = useStyles();
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <AppIcon set="material" name={iconName} size={ROW_ICON_SIZE} style={!setting.available && styles.dim} />
      <RowText setting={setting} error={error} />
      {pending ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} /> : null}
      <ToggleSwitch
        value={value === true}
        onValueChange={onChange}
        disabled={!setting.available || pending}
        accessibilityLabel={setting.name}
      />
    </View>
  );
}

export interface StepperRowProps {
  setting: ControlSetting;
  /** The value as words, e.g. "1 h 30 min" or "Off"; the one asked for while a change is on its way. */
  shown: string;
  pending: boolean;
  error?: string;
  iconName: string;
  divider: boolean;
  /** One step down and up, already on the setting's grid; null at the end of the range. */
  lower: number | null;
  higher: number | null;
  onChange: (next: number) => void;
}

/** A number setting with minus and plus, e.g. a timer. */
export function StepperRow({ setting, shown, pending, error, iconName, divider, lower, higher, onChange }: StepperRowProps) {
  const { theme, styles } = useStyles();
  const step = (next: number | null, label: string, icon: 'remove' | 'add') => {
    const disabled = next === null || !setting.available;
    return (
      <Pressable
        onPress={() => next !== null && onChange(next)}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${setting.name}`}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.smallStep, pressed && styles.pressed, disabled && styles.dim]}
      >
        <Ionicons name={icon} size={SMALL_STEP_ICON_SIZE} color={theme.colors.textPrimary} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.group, divider && styles.rowDivider]}>
      <View style={styles.row}>
        <AppIcon set="material" name={iconName} size={ROW_ICON_SIZE} style={!setting.available && styles.dim} />
        <RowText setting={setting} error={error} />
      </View>
      <View style={styles.stepper}>
        {pending ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} /> : null}
        {step(lower, acCopy.timerShorter, 'remove')}
        <AppText variant="statValue" align="center" style={styles.stepperValue} accessibilityLiveRegion="polite">
          {shown}
        </AppText>
        {step(higher, acCopy.timerLonger, 'add')}
      </View>
    </View>
  );
}

/** A reading, e.g. the fan's RPM. */
export function ReadingRow({ label, value }: { label: string; value: string }) {
  const { theme, styles } = useStyles();
  return (
    <View style={styles.reading}>
      <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="statValue">{value}</AppText>
    </View>
  );
}
