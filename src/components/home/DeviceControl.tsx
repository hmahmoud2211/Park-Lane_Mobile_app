import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { colors } from '../../theme/colors';
import type {
  Capability,
  ClimateCapability,
  ColorCapability,
  Command,
  CoverCapability,
  Device,
  FanCapability,
  LockCapability,
  MediaCapability,
} from '../../types/home.types';
import type { AppTheme } from '../../types/theme.types';
import { AppButton } from '../common/AppButton';
import { AppText } from '../common/AppText';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { FilterChip } from '../ui/FilterChip';
import { LevelSlider } from './LevelSlider';

export interface DeviceControlProps {
  device: Device;
  /** Sends one command; the caller shows it at once and confirms it with the hub. */
  onCommand: (command: Command) => void;
  /** A command from this screen is waiting for the hub. */
  busy?: boolean;
}

const STEP_BUTTON_SIZE = 40;
const STEP_ICON_SIZE = 20;
const SWATCH_SIZE = 30;
const MEDIA_ICON_SIZE = 22;
const BUTTON_HEIGHT = 38;
/** The lock button sits beside the state, so it needs a width of its own. */
const LOCK_BUTTON_WIDTH = 168;

/** Hues the colour swatches set, by the theme colour that draws them. */
const SWATCHES: readonly { token: keyof typeof colors; h: number; label: string }[] = [
  { token: 'hueRed', h: 0, label: 'Red' },
  { token: 'hueOrange', h: 30, label: 'Orange' },
  { token: 'hueYellow', h: 55, label: 'Yellow' },
  { token: 'hueGreen', h: 120, label: 'Green' },
  { token: 'hueCyan', h: 185, label: 'Cyan' },
  { token: 'hueBlue', h: 225, label: 'Blue' },
  { token: 'hueMagenta', h: 300, label: 'Magenta' },
];

const MODE_ICONS: Record<string, string> = {
  off: 'power',
  cool: 'snowflake',
  heat: 'fire',
  heat_cool: 'sun-snowflake-variant',
  auto: 'autorenew',
  dry: 'water-percent',
  fan_only: 'fan',
};

const title = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());

/**
 * Every control a device offers, one per capability the backend reported,
 * then its sensor readings. Disabled while the device is offline.
 */
export function DeviceControl({ device, onCommand, busy = false }: DeviceControlProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const disabled = busy || !device.online;
  const send = (capability: Capability, action: string, value?: unknown) =>
    onCommand({ capability: capability.type, action, value, entityId: capability.entityId });
  // Several entities of one kind (a two-gang switch) are told apart by their own names.
  const several = (type: Capability['type']) => device.capabilities.filter((entry) => entry.type === type).length > 1;

  return (
    <View style={styles.root}>
      {device.capabilities.map((capability) => {
        const key = `${capability.entityId}:${capability.type}`;
        const name = several(capability.type) ? capability.label : null;
        switch (capability.type) {
          case 'power':
            return (
              <View key={key} style={styles.row}>
                <AppText variant="statValue" style={styles.flex}>
                  {name ?? 'Power'}
                </AppText>
                <ToggleSwitch
                  value={capability.value === 'on'}
                  onValueChange={(on) => send(capability, on ? 'on' : 'off')}
                  disabled={disabled}
                  accessibilityLabel={`${device.name} ${name ?? 'power'}`}
                />
              </View>
            );
          case 'brightness':
            return (
              <LevelSlider
                key={key}
                label={name ? `${name} brightness` : 'Brightness'}
                value={capability.value ?? 0}
                min={0}
                max={100}
                step={1}
                format={(value) => `${value}%`}
                onCommit={(value) => send(capability, 'set', value)}
                disabled={disabled}
              />
            );
          case 'color_temp':
            return (
              <LevelSlider
                key={key}
                label="Colour temperature"
                value={capability.value ?? capability.min}
                min={capability.min}
                max={capability.max}
                step={100}
                format={(value) => `${value} K`}
                onCommit={(value) => send(capability, 'set', value)}
                disabled={disabled}
              />
            );
          case 'color':
            return <ColorSwatches key={key} capability={capability} disabled={disabled} onPick={(h) => send(capability, 'set', { h, s: 100 })} />;
          case 'climate':
            return <ClimateControl key={key} capability={capability} disabled={disabled} send={(action, value) => send(capability, action, value)} />;
          case 'cover':
            return <CoverControl key={key} capability={capability} disabled={disabled} send={(action, value) => send(capability, action, value)} />;
          case 'lock':
            return <LockControl key={key} capability={capability} disabled={disabled} send={(action) => send(capability, action)} />;
          case 'fan':
            return <FanControl key={key} capability={capability} disabled={disabled} send={(action, value) => send(capability, action, value)} />;
          case 'media':
            return <MediaControl key={key} capability={capability} disabled={disabled} send={(action, value) => send(capability, action, value)} />;
          case 'press':
            return (
              <AppButton
                key={key}
                title={name ?? capability.label}
                variant="secondary"
                height={BUTTON_HEIGHT}
                disabled={disabled}
                onPress={() => send(capability, 'press')}
              />
            );
          default:
            return null;
        }
      })}

      {device.sensors.length > 0 ? (
        <View style={styles.sensors}>
          {device.sensors.map((sensor) => (
            <View key={sensor.entityId} style={styles.row}>
              <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex} numberOfLines={1}>
                {sensor.label}
              </AppText>
              <AppText variant="statValue">{`${title(sensor.value)}${sensor.unit ? ` ${sensor.unit}` : ''}`}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface ControlProps<T> {
  capability: T;
  disabled: boolean;
  send: (action: string, value?: unknown) => void;
}

function ColorSwatches({ capability, disabled, onPick }: { capability: ColorCapability; disabled: boolean; onPick: (h: number) => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const current = capability.value;
  return (
    <View style={styles.block}>
      <AppText variant="statLabel" color={theme.colors.textSupport}>
        Colour
      </AppText>
      <View style={styles.wrap} accessibilityRole="radiogroup">
        {SWATCHES.map((swatch) => {
          const selected = current !== null && current.s > 20 && Math.abs(current.h - swatch.h) < 15;
          return (
            <Pressable
              key={swatch.token}
              onPress={() => onPick(swatch.h)}
              disabled={disabled}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityLabel={swatch.label}
              accessibilityState={{ selected, disabled }}
              style={[styles.swatch, { backgroundColor: theme.colors[swatch.token] }, selected && styles.swatchSelected, disabled && styles.dim]}
            />
          );
        })}
      </View>
    </View>
  );
}

function ClimateControl({ capability, disabled, send }: ControlProps<ClimateCapability>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const target = capability.target;
  const step = (direction: 1 | -1) => {
    if (target !== null) {
      send('set_temperature', Math.min(capability.max, Math.max(capability.min, target + direction * capability.step)));
    }
  };
  return (
    <View style={styles.block}>
      {target !== null ? (
        <View style={styles.row}>
          <Pressable
            onPress={() => step(-1)}
            disabled={disabled || target <= capability.min}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Lower temperature"
            style={({ pressed }) => [styles.stepButton, styles.stepCool, (pressed || disabled) && styles.dim]}
          >
            <Ionicons name="remove" size={STEP_ICON_SIZE} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={styles.flex}>
            <AppText variant="heroTitle" align="center" accessibilityLiveRegion="polite">
              {`${target}${capability.unit}`}
            </AppText>
            {capability.current !== null ? (
              <AppText variant="tileCaption" align="center" color={theme.colors.textSupport}>
                {`Room ${capability.current}${capability.unit}`}
              </AppText>
            ) : null}
          </View>
          <Pressable
            onPress={() => step(1)}
            disabled={disabled || target >= capability.max}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Raise temperature"
            style={({ pressed }) => [styles.stepButton, styles.stepWarm, (pressed || disabled) && styles.dim]}
          >
            <Ionicons name="add" size={STEP_ICON_SIZE} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
      ) : null}
      {capability.modes.length > 0 ? (
        <Chips
          label="Mode"
          options={capability.modes}
          selected={capability.mode}
          icon={(mode) => MODE_ICONS[mode] ?? 'circle-outline'}
          disabled={disabled}
          onPick={(mode) => send('set_mode', mode)}
        />
      ) : null}
      {capability.fanModes.length > 0 ? (
        <Chips
          label="Fan"
          options={capability.fanModes}
          selected={capability.fanMode}
          icon={() => 'fan'}
          disabled={disabled}
          onPick={(mode) => send('set_fan_mode', mode)}
        />
      ) : null}
    </View>
  );
}

function CoverControl({ capability, disabled, send }: ControlProps<CoverCapability>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <AppButton title="Open" variant="secondary" height={BUTTON_HEIGHT} disabled={disabled} onPress={() => send('open')} style={styles.flex} />
        {capability.canStop ? (
          <AppButton title="Stop" variant="secondary" height={BUTTON_HEIGHT} disabled={disabled} onPress={() => send('stop')} style={styles.flex} />
        ) : null}
        <AppButton title="Close" variant="secondary" height={BUTTON_HEIGHT} disabled={disabled} onPress={() => send('close')} style={styles.flex} />
      </View>
      {capability.canPosition ? (
        <LevelSlider
          label="Position"
          value={capability.position ?? 0}
          min={0}
          max={100}
          step={5}
          format={(value) => `${value}% open`}
          onCommit={(value) => send('set_position', value)}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

/** Unlocking a door asks twice: a stray tap must not open the home. */
function LockControl({ capability, disabled, send }: ControlProps<LockCapability>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [confirming, setConfirming] = useState(false);
  const locked = capability.value === 'locked' || capability.value === 'locking';
  return (
    <View style={styles.row}>
      <AppText variant="statValue" style={styles.flex}>
        {title(capability.value)}
      </AppText>
      {locked ? (
        <AppButton
          title={confirming ? 'Tap again to unlock' : 'Unlock'}
          variant={confirming ? 'gradient' : 'secondary'}
          height={BUTTON_HEIGHT}
          disabled={disabled}
          onPress={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setConfirming(false);
            send('unlock');
          }}
          accessibilityHint="Unlocks the door. Asks you to confirm."
          style={styles.lockButton}
        />
      ) : (
        <AppButton title="Lock" variant="secondary" height={BUTTON_HEIGHT} disabled={disabled} onPress={() => send('lock')} style={styles.lockButton} />
      )}
    </View>
  );
}

function FanControl({ capability, disabled, send }: ControlProps<FanCapability>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.block}>
      {capability.percentage !== null ? (
        <LevelSlider
          label="Speed"
          value={capability.percentage}
          min={0}
          max={100}
          step={10}
          format={(value) => `${value}%`}
          onCommit={(value) => send('set_percentage', value)}
          disabled={disabled}
        />
      ) : null}
      {capability.presetModes.length > 0 ? (
        <Chips
          label="Preset"
          options={capability.presetModes}
          selected={capability.presetMode}
          icon={() => 'fan'}
          disabled={disabled}
          onPick={(preset) => send('set_preset', preset)}
        />
      ) : null}
    </View>
  );
}

function MediaControl({ capability, disabled, send }: ControlProps<MediaCapability>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const playing = capability.state === 'playing';
  const transport: { action: string; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { action: 'previous', icon: 'play-skip-back', label: 'Previous' },
    playing ? { action: 'pause', icon: 'pause', label: 'Pause' } : { action: 'play', icon: 'play', label: 'Play' },
    { action: 'next', icon: 'play-skip-forward', label: 'Next' },
  ];
  return (
    <View style={styles.block}>
      {capability.title ? (
        <AppText variant="statValue" numberOfLines={1}>
          {capability.title}
        </AppText>
      ) : null}
      <View style={[styles.row, styles.transport]}>
        {transport.map((entry) => (
          <Pressable
            key={entry.action}
            onPress={() => send(entry.action)}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={entry.label}
            style={({ pressed }) => [styles.stepButton, (pressed || disabled) && styles.dim]}
          >
            <Ionicons name={entry.icon} size={MEDIA_ICON_SIZE} color={theme.colors.textPrimary} />
          </Pressable>
        ))}
        {capability.muted !== null ? (
          <Pressable
            onPress={() => send('mute', !capability.muted)}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={capability.muted ? 'Unmute' : 'Mute'}
            style={({ pressed }) => [styles.stepButton, (pressed || disabled) && styles.dim]}
          >
            <Ionicons name={capability.muted ? 'volume-mute' : 'volume-high'} size={MEDIA_ICON_SIZE} color={theme.colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>
      {capability.volume !== null ? (
        <LevelSlider
          label="Volume"
          value={Math.round(capability.volume * 100)}
          min={0}
          max={100}
          step={5}
          format={(value) => `${value}%`}
          onCommit={(value) => send('set_volume', value / 100)}
          disabled={disabled}
        />
      ) : null}
      {capability.sources.length > 0 ? (
        <Chips
          label="Source"
          options={capability.sources}
          selected={capability.source}
          icon={() => 'television'}
          disabled={disabled}
          onPick={(source) => send('select_source', source)}
        />
      ) : null}
    </View>
  );
}

function Chips({
  label,
  options,
  selected,
  icon,
  disabled,
  onPick,
}: {
  label: string;
  options: readonly string[];
  selected: string | null;
  icon: (option: string) => string;
  disabled: boolean;
  onPick: (option: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.block, disabled && styles.dim]} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppText variant="statLabel" color={theme.colors.textSupport}>
        {label}
      </AppText>
      <View style={styles.wrap} accessibilityRole="radiogroup">
        {options.map((option) => (
          <FilterChip
            key={option}
            role="radio"
            label={title(option)}
            iconSet="material"
            iconName={icon(option)}
            selected={option === selected}
            onPress={() => onPick(option)}
          />
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.md,
    },
    block: {
      gap: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
    wrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    dim: {
      opacity: 0.4,
    },
    sensors: {
      gap: theme.spacing.xs,
      paddingTop: theme.spacing.sm,
      borderTopWidth: theme.glass.strokeWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    swatch: {
      width: SWATCH_SIZE,
      height: SWATCH_SIZE,
      borderRadius: SWATCH_SIZE / 2,
      borderWidth: 2,
      borderColor: theme.colors.transparent,
    },
    swatchSelected: {
      borderColor: theme.colors.white,
    },
    stepButton: {
      width: STEP_BUTTON_SIZE,
      height: STEP_BUTTON_SIZE,
      borderRadius: STEP_BUTTON_SIZE / 2,
      borderWidth: 1.25,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // As on the Smart Home AC card: minus lit blue, plus violet.
    stepCool: {
      borderColor: theme.colors.neonBlue,
    },
    stepWarm: {
      borderColor: theme.colors.violet,
    },
    transport: {
      justifyContent: 'center',
    },
    lockButton: {
      width: LOCK_BUTTON_WIDTH,
    },
  });
}
