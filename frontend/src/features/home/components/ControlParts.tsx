import { useEffect, useMemo } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { Capability } from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppText } from '../../../components/common/AppText';
import { GlassSurface } from '../../../components/common/GlassSurface';
import { MAX_CHIPS } from '../services/controlPlan';

/**
 * The building blocks of a device's controls: big glass buttons, choice chips, − / +
 * steppers and a confirmation step. Every touch target is at least 48dp, every button has
 * words beside its icon, and nothing has a fixed height, so large text wraps instead of
 * being cut off.
 */

/** The key a control's command goes by, so the pressed control can show it is working. */
export const keyOf = (capability: Capability, action: string, value?: unknown) =>
  `${capability.entityId}:${capability.type}:${action}${value === undefined || typeof value === 'object' ? '' : `:${String(value)}`}`;

const ICON_SIZE = 22;
const HERO_ICON_SIZE = 34;
/** Space between a button's icon and its words. */
const ICON_GAP = 6;
const RADIO_ICON_SIZE = 22;

export type ControlButtonSize = 'regular' | 'large' | 'key' | 'hero';

export interface ControlButtonProps {
  label: string;
  /** A Material Community icon, always drawn beside the label. */
  icon?: string;
  /** A second line under the label, e.g. "Tap to turn off". */
  caption?: string;
  onPress: () => void;
  /** The device is in the state this button sets: drawn lit. */
  selected?: boolean;
  /** `danger` for a step that can't be taken back, e.g. "Yes, unlock". */
  tone?: 'normal' | 'danger';
  /** regular 48dp, large 56dp (icon beside the words); key 72dp and hero 104dp (icon above). */
  size?: ControlButtonSize;
  busy?: boolean;
  /** Not possible now (offline, or nothing to undo): dimmed. */
  disabled?: boolean;
  /** Another command is on its way: not pressable, but not dimmed either. */
  waiting?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'radio';
  /** Spoken after the label, e.g. "On". */
  accessibilityValueText?: string;
  style?: StyleProp<ViewStyle>;
}

/** A device control button on the Glass surface: lit when it is the device's current state. */
export function ControlButton({
  label,
  icon,
  caption,
  onPress,
  selected = false,
  tone = 'normal',
  size = 'large',
  busy = false,
  disabled = false,
  waiting = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityValueText,
  style,
}: ControlButtonProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const stacked = size === 'key' || size === 'hero';
  const danger = tone === 'danger';
  const iconSize = size === 'hero' ? HERO_ICON_SIZE : ICON_SIZE;
  const strokeColors: readonly [string, string] = danger
    ? [theme.colors.error, theme.colors.emergencyStroke]
    : selected
      ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
      : [theme.colors.dividerSubtle, theme.colors.dividerSubtle];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || waiting || busy}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? (caption ? `${label}. ${caption}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, checked: accessibilityRole === 'radio' ? selected : undefined, disabled: disabled || waiting, busy }}
      accessibilityValue={accessibilityValueText ? { text: accessibilityValueText } : undefined}
      style={({ pressed }) => [styles.shell, styles[size], pressed && styles.pressed, disabled && styles.dim, style]}
    >
      <GlassSurface
        radius={theme.borderRadius.md}
        glow={selected && !danger}
        stroke="gradient"
        strokeColors={strokeColors}
        blurred={false}
        fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
        style={[styles.surface, styles[size], stacked ? styles.stacked : styles.inline, !selected && styles.idle, danger && styles.danger]}
      >
        {busy ? (
          <ActivityIndicator size={size === 'hero' ? 'large' : 'small'} color={theme.colors.textPrimary} />
        ) : icon ? (
          <AppIcon set="material" name={icon} size={iconSize} />
        ) : null}
        <View style={stacked ? styles.stackedText : styles.inlineText}>
          <AppText variant={size === 'hero' ? 'controlState' : 'controlLabel'} align={stacked ? 'center' : undefined}>
            {label}
          </AppText>
          {caption ? (
            <AppText variant="controlCaption" color={theme.colors.textSupport} align={stacked ? 'center' : undefined}>
              {caption}
            </AppText>
          ) : null}
        </View>
      </GlassSurface>
    </Pressable>
  );
}

/** A heading over a group of controls, e.g. "Mode". */
export function SectionLabel({ children }: { children: string }) {
  const theme = useAppTheme();
  return (
    <AppText variant="controlCaption" color={theme.colors.textSupport} accessibilityRole="header">
      {children}
    </AppText>
  );
}

export interface Choice {
  value: string;
  label: string;
  icon?: string;
}

export interface ChoiceGroupProps {
  label: string;
  choices: readonly Choice[];
  selected: string | null;
  onPick: (value: string) => void;
  /** The choice whose command is on its way. */
  busyValue?: string | null;
  disabled?: boolean;
  waiting?: boolean;
}

/**
 * One of a few choices. Up to six sit as big chips, three to a row (two when there are
 * four); more go in a list that scrolls inside the page.
 */
export function ChoiceGroup({ label, choices, selected, onPick, busyValue = null, disabled = false, waiting = false }: ChoiceGroupProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (choices.length === 0) return null;
  const chips = choices.length <= MAX_CHIPS;
  const basis = choices.length === 4 ? theme.layout.deviceControl.chipBasisPair : theme.layout.deviceControl.chipBasis;

  return (
    <View style={styles.group}>
      <SectionLabel>{label}</SectionLabel>
      {chips ? (
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {choices.map((choice) => (
            <ControlButton
              key={choice.value}
              label={choice.label}
              icon={choice.icon}
              size="regular"
              accessibilityRole="radio"
              selected={choice.value === selected}
              busy={busyValue === choice.value}
              disabled={disabled}
              waiting={waiting}
              onPress={() => onPick(choice.value)}
              style={[styles.chip, { flexBasis: basis }]}
            />
          ))}
        </View>
      ) : (
        <GlassSurface
          radius={theme.borderRadius.md}
          stroke="gradient"
          strokeColors={[theme.colors.dividerSubtle, theme.colors.dividerSubtle]}
          blurred={false}
          fillOpacity={theme.glass.subtleFillOpacity}
          style={[styles.idle, disabled && styles.dim]}
        >
          <ScrollView style={styles.list} nestedScrollEnabled accessibilityRole="radiogroup" accessibilityLabel={label}>
            {choices.map((choice, index) => {
              const isSelected = choice.value === selected;
              const busy = busyValue === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => onPick(choice.value)}
                  disabled={disabled || waiting || busy}
                  accessibilityRole="radio"
                  accessibilityLabel={choice.label}
                  accessibilityState={{ selected: isSelected, checked: isSelected, disabled: disabled || waiting, busy }}
                  style={({ pressed }) => [styles.listRow, index > 0 && styles.listDivider, pressed && styles.pressed]}
                >
                  <AppIcon
                    set="material"
                    name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={RADIO_ICON_SIZE}
                    color={isSelected ? theme.colors.accent : theme.colors.textSupport}
                  />
                  <AppText variant="controlLabel" style={styles.flex}>
                    {choice.label}
                  </AppText>
                  {busy ? <ActivityIndicator size="small" color={theme.colors.textPrimary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </GlassSurface>
      )}
    </View>
  );
}

/** On and Off as two chips, for a setting that is one or the other (swing, shuffle, away mode). */
export const ON_OFF: readonly Choice[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

export interface StepperProps {
  /** What is being set, for screen readers: "temperature" → "Lower temperature". */
  label: string;
  /** The words over the value, e.g. "Set to". */
  caption: string;
  valueText: string;
  /** The words on the buttons, e.g. "Cooler" and "Warmer". */
  lowerLabel: string;
  raiseLabel: string;
  onStep: (direction: 1 | -1) => void;
  canLower: boolean;
  canRaise: boolean;
  /** The value as the big figure, when nothing else on the control is. */
  large?: boolean;
  busy?: 'lower' | 'raise' | null;
  disabled?: boolean;
  waiting?: boolean;
}

/** A value with big − and + buttons either side, e.g. the temperature an AC is set to. */
export function Stepper({
  label,
  caption,
  valueText,
  lowerLabel,
  raiseLabel,
  onStep,
  canLower,
  canRaise,
  large = false,
  busy = null,
  disabled = false,
  waiting = false,
}: StepperProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.stepper}>
      <ControlButton
        label={lowerLabel}
        icon="minus"
        size="key"
        accessibilityLabel={`${lowerLabel}: lower ${label}`}
        busy={busy === 'lower'}
        disabled={disabled || !canLower}
        waiting={waiting}
        onPress={() => onStep(-1)}
        style={styles.stepButton}
      />
      <View style={styles.stepValue} accessible accessibilityLabel={`${caption} ${valueText}`} accessibilityLiveRegion="polite">
        <AppText variant="controlCaption" color={theme.colors.textSupport} align="center">
          {caption}
        </AppText>
        <AppText variant={large ? 'controlFigure' : 'controlState'} align="center">
          {valueText}
        </AppText>
      </View>
      <ControlButton
        label={raiseLabel}
        icon="plus"
        size="key"
        accessibilityLabel={`${raiseLabel}: raise ${label}`}
        busy={busy === 'raise'}
        disabled={disabled || !canRaise}
        waiting={waiting}
        onPress={() => onStep(1)}
        style={styles.stepButton}
      />
    </View>
  );
}

export interface ConfirmStepProps {
  question: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  waiting?: boolean;
}

/** "Are you sure?" before a step that opens the home or turns off the alarm. */
export function ConfirmStep({ question, detail, confirmLabel, onConfirm, onCancel, disabled = false, waiting = false }: ConfirmStepProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Screen readers hear the question as soon as it appears.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${question} ${detail}`);
  }, [question, detail]);
  return (
    <View style={styles.confirm} accessibilityLiveRegion="assertive">
      <AppText variant="controlLabel">{question}</AppText>
      <AppText variant="controlCaption" color={theme.colors.textSecondary}>
        {detail}
      </AppText>
      <View style={styles.row}>
        <ControlButton label={confirmLabel} icon="check" tone="danger" disabled={disabled} waiting={waiting} onPress={onConfirm} style={styles.flex} />
        <ControlButton label="Cancel" icon="close" onPress={onCancel} style={styles.flex} />
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const sizes = theme.layout.deviceControl;
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    shell: {
      borderRadius: theme.borderRadius.md,
    },
    regular: {
      minHeight: sizes.minTarget,
    },
    large: {
      minHeight: sizes.button,
    },
    key: {
      minHeight: sizes.remoteKey,
    },
    hero: {
      minHeight: sizes.heroButton,
    },
    surface: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm + theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      gap: ICON_GAP,
    },
    inline: {
      flexDirection: 'row',
    },
    stacked: {
      flexDirection: 'column',
    },
    inlineText: {
      flexShrink: 1,
    },
    stackedText: {
      alignItems: 'center',
    },
    idle: {
      backgroundColor: theme.colors.fieldFill,
    },
    danger: {
      backgroundColor: theme.colors.errorFill,
    },
    pressed: {
      opacity: 0.75,
    },
    dim: {
      opacity: 0.4,
    },
    group: {
      gap: theme.spacing.sm,
    },
    wrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    chip: {
      flexGrow: 1,
    },
    list: {
      maxHeight: sizes.listMaxHeight,
    },
    listRow: {
      minHeight: sizes.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm + theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
    },
    listDivider: {
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    stepButton: {
      minWidth: sizes.stepButton + theme.spacing.lg,
    },
    stepValue: {
      flex: 1,
      alignItems: 'center',
    },
    confirm: {
      gap: theme.spacing.sm,
      padding: theme.spacing.sm + theme.spacing.xs,
      borderRadius: theme.borderRadius.md,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.warningStroke,
      backgroundColor: theme.colors.warningFill,
    },
  });
}
