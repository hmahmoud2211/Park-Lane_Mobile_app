import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { colors } from '../../../theme/colors';
import type {
  Capability,
  ClimateCapability,
  ColorCapability,
  CoverCapability,
  FanCapability,
  MediaCapability,
  NumberCapability,
  OptionCapability,
  VacuumCapability,
  WaterHeaterCapability,
} from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppText } from '../../../components/common/AppText';
import { currentFanSpeed, fanSpeeds, numberLayout, stepValue } from '../services/controlPlan';
import {
  colorTempLabel,
  directionLabel,
  fanModeLabel,
  formatNumber,
  optionLabel,
  percentText,
  presetLabel,
  repeatLabel,
  swingLabel,
} from '../services/deviceLabels';
import type { ControlKit } from '../types';
import { ChoiceGroup, ControlButton, ON_OFF, SectionLabel, Stepper, keyOf } from './ControlParts';
import { HUMIDITY_STEP, AlarmMain, ClimateMain, HumidifierMain, LockMain, MediaMain, MowerMain, OpenCloseMain, PowerToggle, VacuumMain, WaterHeaterMain } from './MainControl';
import { LevelSlider } from './LevelSlider';

/**
 * Everything below a device's main control: the main capability's own extras (an AC's fan
 * speed and swing, a TV's sound mode), then one block per other capability. The same
 * blocks fill "More settings".
 */

const busyValue = (kit: ControlKit, capability: Capability, action: string, values: readonly string[]) =>
  values.find((value) => kit.isBusy(keyOf(capability, action, value))) ?? null;

const onOff = (value: boolean | null) => (value === null ? null : value ? 'on' : 'off');

/** The main capability's controls beyond its main block; nothing for one that has none. */
export function CapabilityExtras({ capability, kit }: { capability: Capability; kit: ControlKit }) {
  switch (capability.type) {
    case 'climate':
      return <ClimateExtras capability={capability} kit={kit} />;
    case 'media':
      return <MediaExtras capability={capability} kit={kit} />;
    case 'cover':
      return <TiltControls capability={capability} kit={kit} />;
    case 'vacuum':
      return <VacuumExtras capability={capability} kit={kit} />;
    case 'water_heater':
      return <WaterHeaterExtras capability={capability} kit={kit} />;
    default:
      return null;
  }
}

function ClimateExtras({ capability: climate, kit }: { capability: ClimateCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const humidityKey = keyOf(climate, 'set_humidity');
  return (
    <View style={styles.block}>
      <ChoiceGroup
        label="Fan speed"
        choices={climate.fanModes.map((mode) => ({ value: mode, label: fanModeLabel(mode), icon: 'fan' }))}
        selected={climate.fanMode}
        busyValue={busyValue(kit, climate, 'set_fan_mode', climate.fanModes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(climate, 'set_fan_mode', mode)}
      />
      <ChoiceGroup
        label="Swing (air direction)"
        choices={climate.swingModes.map((mode) => ({ value: mode, label: swingLabel(mode) }))}
        selected={climate.swingMode}
        busyValue={busyValue(kit, climate, 'set_swing_mode', climate.swingModes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(climate, 'set_swing_mode', mode)}
      />
      <ChoiceGroup
        label="Preset"
        choices={climate.presetModes.map((preset) => ({ value: preset, label: presetLabel(preset) }))}
        selected={climate.presetMode}
        busyValue={busyValue(kit, climate, 'set_preset', climate.presetModes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(preset) => kit.send(climate, 'set_preset', preset)}
      />
      {climate.targetHumidity !== null ? (
        <View style={styles.block}>
          <SectionLabel>Humidity</SectionLabel>
          <Stepper
            label="humidity"
            caption="Keep it at"
            valueText={percentText(climate.targetHumidity)}
            lowerLabel="Drier"
            raiseLabel="More moist"
            canLower={climate.targetHumidity > climate.minHumidity}
            canRaise={climate.targetHumidity < climate.maxHumidity}
            busy={kit.isBusy(humidityKey) ? 'raise' : null}
            disabled={kit.disabled}
            waiting={kit.waiting}
            onStep={(direction) =>
              kit.send(
                climate,
                'set_humidity',
                stepValue(climate.targetHumidity ?? climate.minHumidity, direction, HUMIDITY_STEP, climate.minHumidity, climate.maxHumidity),
                humidityKey,
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}

function MediaExtras({ capability: media, kit }: { capability: MediaCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const volumeKey = keyOf(media, 'set_volume');
  return (
    <View style={styles.block}>
      {media.volume !== null ? (
        <LevelSlider
          label="Volume level"
          value={Math.round(media.volume * 100)}
          min={0}
          max={100}
          step={1}
          nudge={5}
          format={percentText}
          busy={kit.isBusy(volumeKey)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(media, 'set_volume', value / 100, volumeKey)}
        />
      ) : null}
      {media.canStop ? (
        <ControlButton
          label="Stop"
          icon="stop"
          busy={kit.isBusy(keyOf(media, 'stop'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Stop ${kit.deviceName}`}
          onPress={() => kit.send(media, 'stop')}
        />
      ) : null}
      <ChoiceGroup
        label="Sound"
        choices={media.soundModes.map((mode) => ({ value: mode, label: optionLabel(mode) }))}
        selected={media.soundMode}
        busyValue={busyValue(kit, media, 'select_sound_mode', media.soundModes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(media, 'select_sound_mode', mode)}
      />
      {media.shuffle !== null ? (
        <ChoiceGroup
          label="Shuffle"
          choices={ON_OFF}
          selected={onOff(media.shuffle)}
          busyValue={kit.isBusy(keyOf(media, 'set_shuffle')) ? onOff(!media.shuffle) : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(value) => kit.send(media, 'set_shuffle', value === 'on', keyOf(media, 'set_shuffle'))}
        />
      ) : null}
      {media.repeat !== null ? (
        <ChoiceGroup
          label="Repeat"
          choices={(['off', 'one', 'all'] as const).map((mode) => ({ value: mode, label: repeatLabel(mode) }))}
          selected={media.repeat}
          busyValue={busyValue(kit, media, 'set_repeat', ['off', 'one', 'all'])}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(mode) => kit.send(media, 'set_repeat', mode)}
        />
      ) : null}
    </View>
  );
}

/** A blind's slats: open, stop and close them, or set their angle. */
function TiltControls({ capability: cover, kit }: { capability: CoverCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tiltKey = keyOf(cover, 'set_tilt');
  const button = (action: 'open_tilt' | 'stop_tilt' | 'close_tilt', label: string, icon: string) => (
    <ControlButton
      key={action}
      label={label}
      icon={icon}
      busy={kit.isBusy(keyOf(cover, action))}
      disabled={kit.disabled}
      waiting={kit.waiting}
      onPress={() => kit.send(cover, action)}
      style={styles.flex}
    />
  );
  return (
    <View style={styles.block}>
      {cover.canTilt ? (
        <View style={styles.block}>
          <SectionLabel>Slats</SectionLabel>
          <View style={styles.row}>
            {button('open_tilt', 'Open slats', 'arrow-top-right')}
            {cover.canStop ? button('stop_tilt', 'Stop', 'stop') : null}
            {button('close_tilt', 'Close slats', 'arrow-bottom-right')}
          </View>
        </View>
      ) : null}
      {cover.canSetTilt ? (
        <LevelSlider
          label="Slat angle"
          value={cover.tilt ?? 0}
          min={0}
          max={100}
          step={5}
          nudge={10}
          format={(value) => (value <= 0 ? 'Closed' : value >= 100 ? 'Open' : `${value}% open`)}
          busy={kit.isBusy(tiltKey)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(cover, 'set_tilt', value, tiltKey)}
        />
      ) : null}
    </View>
  );
}

function VacuumExtras({ capability: vacuum, kit }: { capability: VacuumCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const actions: { action: string; label: string; caption?: string; icon: string; shown: boolean }[] = [
    { action: 'stop', label: 'Stop', icon: 'stop', shown: vacuum.canStop },
    { action: 'locate', label: 'Find it', caption: 'Makes it beep', icon: 'map-marker-radius', shown: vacuum.canLocate },
    { action: 'clean_spot', label: 'Clean one spot', icon: 'target', shown: vacuum.canSpot },
  ];
  return (
    <View style={styles.block}>
      <ChoiceGroup
        label="Suction"
        choices={vacuum.fanSpeeds.map((speed) => ({ value: speed, label: fanModeLabel(speed), icon: 'fan' }))}
        selected={vacuum.fanSpeed}
        busyValue={busyValue(kit, vacuum, 'set_fan_speed', vacuum.fanSpeeds)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(speed) => kit.send(vacuum, 'set_fan_speed', speed)}
      />
      <View style={styles.row}>
        {actions
          .filter((entry) => entry.shown)
          .map((entry) => (
            <ControlButton
              key={entry.action}
              label={entry.label}
              caption={entry.caption}
              icon={entry.icon}
              busy={kit.isBusy(keyOf(vacuum, entry.action))}
              disabled={kit.disabled}
              waiting={kit.waiting}
              onPress={() => kit.send(vacuum, entry.action)}
              style={styles.chip}
            />
          ))}
      </View>
    </View>
  );
}

function WaterHeaterExtras({ capability: heater, kit }: { capability: WaterHeaterCapability; kit: ControlKit }) {
  if (heater.away === null) return null;
  return (
    <ChoiceGroup
      label="Away mode (saves energy while you are out)"
      choices={ON_OFF}
      selected={onOff(heater.away)}
      busyValue={kit.isBusy(keyOf(heater, 'set_away')) ? onOff(!heater.away) : null}
      disabled={kit.disabled}
      waiting={kit.waiting}
      onPick={(value) => kit.send(heater, 'set_away', value === 'on', keyOf(heater, 'set_away'))}
    />
  );
}

/** Hues the colour swatches set, by the theme colour that draws them. */
const SWATCHES: readonly { token: keyof typeof colors; h: number; label: string }[] = [
  { token: 'hueRed', h: 0, label: 'Red' },
  { token: 'hueOrange', h: 30, label: 'Orange' },
  { token: 'hueYellow', h: 55, label: 'Yellow' },
  { token: 'hueGreen', h: 120, label: 'Green' },
  { token: 'hueCyan', h: 185, label: 'Cyan' },
  { token: 'hueBlue', h: 225, label: 'Blue' },
  { token: 'hueMagenta', h: 300, label: 'Pink' },
];

/** A light's colour: one swatch per hue, each with its name under it. */
function ColorSwatches({ capability, kit, label }: { capability: ColorCapability; kit: ControlKit; label: string }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const current = capability.value;
  return (
    <View style={[styles.block, kit.disabled && styles.dim]}>
      <SectionLabel>{label}</SectionLabel>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {SWATCHES.map((swatch) => {
          const selected = current !== null && current.s > 20 && Math.abs(current.h - swatch.h) < 15;
          return (
            <Pressable
              key={swatch.token}
              onPress={() => kit.send(capability, 'set', { h: swatch.h, s: 100 }, `${keyOf(capability, 'set')}:${swatch.h}`)}
              disabled={kit.disabled || kit.waiting}
              accessibilityRole="radio"
              accessibilityLabel={`${swatch.label} light`}
              accessibilityState={{ selected, checked: selected, disabled: kit.disabled || kit.waiting, busy: kit.isBusy(`${keyOf(capability, 'set')}:${swatch.h}`) }}
              style={({ pressed }) => [styles.swatchTarget, pressed && styles.pressed]}
            >
              <View style={[styles.swatch, { backgroundColor: theme.colors[swatch.token] }, selected && styles.swatchSelected]} />
              <AppText variant="controlCaption" align="center">
                {swatch.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A fan's speed (one button per real speed, or a slider), presets, swing and direction. */
function FanControls({ capability: fan, kit, label }: { capability: FanCapability; kit: ControlKit; label: string }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const speeds = fanSpeeds(fan);
  const speedKey = keyOf(fan, 'set_percentage');
  const current = speeds ? currentFanSpeed(speeds, fan.percentage) : null;
  return (
    <View style={styles.block}>
      {fan.percentage !== null && speeds ? (
        <ChoiceGroup
          label={label}
          choices={speeds.map((speed) => ({ value: String(speed.percentage), label: speed.label, icon: 'fan' }))}
          selected={current ? String(current.percentage) : null}
          busyValue={speeds.map((speed) => String(speed.percentage)).find((value) => kit.isBusy(keyOf(fan, 'set_percentage', Number(value)))) ?? null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(value) => kit.send(fan, 'set_percentage', Number(value))}
        />
      ) : fan.percentage !== null ? (
        <LevelSlider
          label={label}
          value={fan.percentage}
          min={0}
          max={100}
          step={Math.max(1, Math.round(fan.percentageStep))}
          nudge={Math.max(10, Math.round(fan.percentageStep))}
          format={(value) => (value <= 0 ? 'Off' : percentText(value))}
          busy={kit.isBusy(speedKey)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(fan, 'set_percentage', value, speedKey)}
        />
      ) : null}
      <ChoiceGroup
        label="Preset"
        choices={fan.presetModes.map((preset) => ({ value: preset, label: presetLabel(preset) }))}
        selected={fan.presetMode}
        busyValue={busyValue(kit, fan, 'set_preset', fan.presetModes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(preset) => kit.send(fan, 'set_preset', preset)}
      />
      {fan.oscillating !== null ? (
        <ChoiceGroup
          label="Swing (turns side to side)"
          choices={ON_OFF}
          selected={onOff(fan.oscillating)}
          busyValue={kit.isBusy(keyOf(fan, 'set_oscillating')) ? onOff(!fan.oscillating) : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(value) => kit.send(fan, 'set_oscillating', value === 'on', keyOf(fan, 'set_oscillating'))}
        />
      ) : null}
      {fan.direction !== null ? (
        <ChoiceGroup
          label="Direction"
          choices={(['forward', 'reverse'] as const).map((direction) => ({ value: direction, label: directionLabel(direction) }))}
          selected={fan.direction}
          busyValue={busyValue(kit, fan, 'set_direction', ['forward', 'reverse'])}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(direction) => kit.send(fan, 'set_direction', direction)}
        />
      ) : null}
    </View>
  );
}

const OPTION_TITLES: Readonly<Record<OptionCapability['role'], string | null>> = {
  effect: 'Light effect',
  activity: 'Activity',
  setting: null,
};

function NumberControl({ capability: number, kit }: { capability: NumberCapability; kit: ControlKit }) {
  const key = keyOf(number, 'set');
  const unit = number.unit ? ` ${number.unit}` : '';
  const value = number.value ?? number.min;
  if (numberLayout(number) === 'stepper') {
    return (
      <View>
        <SectionLabel>{number.label}</SectionLabel>
        <Stepper
          label={number.label.toLowerCase()}
          caption="Set to"
          valueText={number.value === null ? 'Not known' : `${formatNumber(number.value)}${unit}`}
          lowerLabel="Less"
          raiseLabel="More"
          canLower={value > number.min}
          canRaise={value < number.max}
          busy={kit.isBusy(key) ? 'raise' : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onStep={(direction) => kit.send(number, 'set', stepValue(value, direction, number.step, number.min, number.max), key)}
        />
      </View>
    );
  }
  return (
    <LevelSlider
      label={number.label}
      value={value}
      min={number.min}
      max={number.max}
      step={number.step > 0 ? number.step : 1}
      nudge={Math.max(number.step, (number.max - number.min) / 10)}
      format={(next) => `${formatNumber(next)}${unit}`}
      busy={kit.isBusy(key)}
      disabled={kit.disabled}
      waiting={kit.waiting}
      onCommit={(next) => kit.send(number, 'set', next, key)}
    />
  );
}

/** A name over a control that has none of its own (a second AC on the device, a lock in More controls). */
function Titled({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.block}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  );
}

/**
 * One capability's whole control, for "More controls" and "More settings". `named` puts the
 * capability's own label on it, for a device with several of a kind (a two-gang switch).
 */
export function CapabilityBlock({ capability, kit, named }: { capability: Capability; kit: ControlKit; named: boolean }) {
  const title = (fallback: string) => (named ? `${capability.label}: ${fallback.toLowerCase()}` : fallback);
  switch (capability.type) {
    case 'power':
      return <PowerToggle capability={capability} kit={kit} size="large" name={capability.label} />;
    case 'brightness': {
      const key = keyOf(capability, 'set');
      return (
        <LevelSlider
          label={title('Brightness')}
          value={capability.value ?? 0}
          min={0}
          max={100}
          step={1}
          nudge={10}
          format={(value) => (value <= 0 ? 'Off' : percentText(value))}
          busy={kit.isBusy(key)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(capability, 'set', value, key)}
        />
      );
    }
    case 'color_temp': {
      const key = keyOf(capability, 'set');
      return (
        <LevelSlider
          label={title('White light: warm to cool')}
          value={capability.value ?? capability.min}
          min={capability.min}
          max={capability.max}
          step={50}
          nudge={Math.max(100, Math.round((capability.max - capability.min) / 10 / 50) * 50)}
          format={colorTempLabel}
          busy={kit.isBusy(key)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(capability, 'set', value, key)}
        />
      );
    }
    case 'color':
      return <ColorSwatches capability={capability} kit={kit} label={title('Colour')} />;
    case 'fan':
      return <FanControls capability={capability} kit={kit} label={title('Fan speed')} />;
    case 'option':
      return (
        <ChoiceGroup
          label={OPTION_TITLES[capability.role] ? title(OPTION_TITLES[capability.role] as string) : capability.label}
          choices={capability.options.map((option) => ({ value: option, label: optionLabel(option) }))}
          selected={capability.value}
          busyValue={busyValue(kit, capability, 'select', capability.options)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onPick={(option) => kit.send(capability, 'select', option)}
        />
      );
    case 'number':
      return <NumberControl capability={capability} kit={kit} />;
    case 'press':
      return (
        <ControlButton
          label={capability.label}
          icon="gesture-tap-button"
          busy={kit.isBusy(keyOf(capability, 'press'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Press ${capability.label}`}
          onPress={() => kit.send(capability, 'press')}
        />
      );
    case 'climate':
      return (
        <Titled title={capability.label}>
          <ClimateMain capability={capability} kit={kit} />
          <CapabilityExtras capability={capability} kit={kit} />
        </Titled>
      );
    case 'media':
      return (
        <Titled title={capability.label}>
          <MediaMain capability={capability} kit={kit} />
          <CapabilityExtras capability={capability} kit={kit} />
        </Titled>
      );
    case 'cover':
    case 'valve':
      return (
        <Titled title={capability.label}>
          <OpenCloseMain capability={capability} kit={kit} />
          <CapabilityExtras capability={capability} kit={kit} />
        </Titled>
      );
    case 'vacuum':
      return (
        <Titled title={capability.label}>
          <VacuumMain capability={capability} kit={kit} />
          <CapabilityExtras capability={capability} kit={kit} />
        </Titled>
      );
    case 'lock':
      return (
        <Titled title={capability.label}>
          <LockMain capability={capability} kit={kit} />
        </Titled>
      );
    case 'alarm':
      return (
        <Titled title={capability.label}>
          <AlarmMain capability={capability} kit={kit} />
        </Titled>
      );
    case 'mower':
      return (
        <Titled title={capability.label}>
          <MowerMain capability={capability} kit={kit} />
        </Titled>
      );
    case 'humidifier':
      return (
        <Titled title={capability.label}>
          <HumidifierMain capability={capability} kit={kit} />
        </Titled>
      );
    case 'water_heater':
      return (
        <Titled title={capability.label}>
          <WaterHeaterMain capability={capability} kit={kit} />
          <CapabilityExtras capability={capability} kit={kit} />
        </Titled>
      );
    default:
      return null;
  }
}

function createStyles(theme: AppTheme) {
  const sizes = theme.layout.deviceControl;
  return StyleSheet.create({
    block: {
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
    chip: {
      flexGrow: 1,
      flexBasis: sizes.chipBasis,
    },
    dim: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.7,
    },
    swatches: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    swatchTarget: {
      minWidth: sizes.minTarget,
      minHeight: sizes.minTarget,
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.xs,
    },
    swatch: {
      width: sizes.swatch,
      height: sizes.swatch,
      borderRadius: sizes.swatch / 2,
      borderWidth: 3,
      borderColor: theme.colors.transparent,
    },
    swatchSelected: {
      borderColor: theme.colors.white,
    },
  });
}
