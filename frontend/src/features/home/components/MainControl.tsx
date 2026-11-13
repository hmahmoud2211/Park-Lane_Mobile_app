import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type {
  AlarmCapability,
  Capability,
  ClimateCapability,
  CoverCapability,
  Device,
  DeviceKind,
  HumidifierCapability,
  LockCapability,
  MediaCapability,
  MowerCapability,
  PowerCapability,
  VacuumCapability,
  ValveCapability,
  WaterHeaterCapability,
} from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppInput } from '../../../components/common/AppInput';
import { AppText } from '../../../components/common/AppText';
import { climatePowerCommand, isTvRemote, playPauseAction, stepValue, volumeCommand, type ControlPlan } from '../services/controlPlan';
import {
  alarmModeLabel,
  alarmModeState,
  climateModeLabel,
  isLocked,
  openAmountLabel,
  percentText,
  presetLabel,
  sourceLabel,
  temperatureText,
  waterHeaterModeLabel,
} from '../services/deviceLabels';
import type { ControlKit } from '../types';
import { ChoiceGroup, ConfirmStep, ControlButton, Stepper, keyOf, type Choice } from './ControlParts';
import { LevelSlider } from './LevelSlider';
import { TvRemote } from './TvRemote';

/**
 * The one obvious control at the top of a device's screen, chosen by what the device is:
 * a big On/Off for lights and plugs, the temperature with − / + for an AC, a remote for a
 * TV, Open / Stop / Close for curtains, Lock / Unlock for a door…
 */

export interface MainControlProps {
  device: Device;
  plan: ControlPlan;
  kit: ControlKit;
}

export function MainControl({ device, plan, kit }: MainControlProps) {
  const main = plan.main;
  if (!main) return null;
  // A TV: its remote keys, or a TV on the CUBE gateway, which lists them only while it is on.
  if (isTvRemote(plan) || (device.kind === 'media' && device.source === 'gateway' && (main.type === 'media' || main.type === 'power'))) {
    return (
      <TvRemote
        media={main.type === 'media' ? main : undefined}
        power={main.type === 'power' ? main : plan.mainPower[0]}
        remote={plan.remote}
        kit={kit}
      />
    );
  }
  switch (main.type) {
    case 'power':
      return <PowerMain capabilities={[main, ...plan.mainPower]} kit={kit} />;
    case 'climate':
      return <ClimateMain capability={main} power={plan.mainPower[0]} kit={kit} />;
    case 'media':
      return <MediaMain capability={main} power={plan.mainPower[0]} kit={kit} />;
    case 'cover':
    case 'valve':
      return <OpenCloseMain capability={main} kit={kit} />;
    case 'vacuum':
      return <VacuumMain capability={main} kit={kit} />;
    case 'lock':
      return <LockMain capability={main} kit={kit} />;
    case 'alarm':
      return <AlarmMain capability={main} kit={kit} />;
    case 'mower':
      return <MowerMain capability={main} kit={kit} />;
    case 'humidifier':
      return <HumidifierMain capability={main} power={plan.mainPower[0]} kit={kit} />;
    case 'water_heater':
      return <WaterHeaterMain capability={main} power={plan.mainPower[0]} kit={kit} />;
    default:
      return null;
  }
}

/** The command in flight among `values` of one action, for the chip that shows it is working. */
function busyValue(kit: ControlKit, capability: Capability, action: string, values: readonly string[]): string | null {
  return values.find((value) => kit.isBusy(keyOf(capability, action, value))) ?? null;
}

const POWER_ICONS: Partial<Record<DeviceKind, [on: string, off: string]>> = {
  light: ['lightbulb-on', 'lightbulb-outline'],
  plug: ['power-plug', 'power-plug-off'],
  fan: ['fan', 'fan-off'],
};

const powerIcon = (kind: DeviceKind, on: boolean) => POWER_ICONS[kind]?.[on ? 0 : 1] ?? 'power';

export interface PowerToggleProps {
  capability: PowerCapability;
  kit: ControlKit;
  size?: 'hero' | 'large';
  /** Names the output on a device with several, e.g. "Left". */
  name?: string;
  /** Stays pressable while the device is not responding: a TV that is off can often still be woken. */
  enabledOffline?: boolean;
}

/** The device's On/Off, showing its state in words; both choices when the state is not known. */
export function PowerToggle({ capability, kit, size = 'hero', name, enabledOffline = false }: PowerToggleProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const target = name ? `${kit.deviceName} ${name}` : kit.deviceName;
  const key = `${capability.entityId}:power`;
  const disabled = kit.disabled && !enabledOffline;
  const busy = kit.isBusy(key);

  if (capability.value === 'unknown') {
    return (
      <View style={styles.block}>
        <AppText variant="controlCaption" color={theme.colors.textSupport}>
          {`${name ? `${name}: ` : ''}It doesn’t say whether it is on or off.`}
        </AppText>
        <View style={styles.row}>
          {(['on', 'off'] as const).map((action) => (
            <ControlButton
              key={action}
              label={action === 'on' ? 'Turn on' : 'Turn off'}
              icon="power"
              busy={busy}
              disabled={disabled}
              waiting={kit.waiting}
              accessibilityLabel={`Turn ${action} ${target}`}
              onPress={() => kit.send(capability, action, undefined, key)}
              style={styles.flex}
            />
          ))}
        </View>
      </View>
    );
  }

  const on = capability.value === 'on';
  const action = on ? 'off' : 'on';
  return (
    <ControlButton
      label={name ? `${name}: ${on ? 'On' : 'Off'}` : on ? 'On' : 'Off'}
      caption={on ? 'Tap to turn off' : 'Tap to turn on'}
      icon={powerIcon(kit.kind, on)}
      size={size}
      selected={on}
      busy={busy}
      disabled={disabled}
      waiting={kit.waiting}
      accessibilityLabel={`Turn ${action} ${target}`}
      accessibilityValueText={on ? 'On' : 'Off'}
      onPress={() => kit.send(capability, action, undefined, key)}
    />
  );
}

/** Lights, switches and plugs: one big On/Off, one per output on a two-gang switch. */
export function PowerMain({ capabilities, kit }: { capabilities: PowerCapability[]; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (capabilities.length === 1) {
    return <PowerToggle capability={capabilities[0]} kit={kit} />;
  }
  return (
    <View style={styles.block}>
      {capabilities.map((capability) => (
        <PowerToggle key={capability.entityId} capability={capability} kit={kit} size="large" name={capability.label} />
      ))}
    </View>
  );
}

/** A figure with its caption over it, e.g. "In the room now" / "24°". */
function Figure({ caption, value, extra }: { caption: string; value: string; extra?: string | null }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${caption}: ${value}${extra ? `, ${extra}` : ''}`}>
      <AppText variant="controlCaption" color={theme.colors.textSupport} align="center">
        {caption}
      </AppText>
      <AppText variant="controlFigure" align="center">
        {value}
      </AppText>
      {extra ? (
        <AppText variant="controlCaption" color={theme.colors.textSupport} align="center">
          {extra}
        </AppText>
      ) : null}
    </View>
  );
}

/** Which side of a stepper was pressed last, so that button shows it is working. */
function useStepSide() {
  return useState<'lower' | 'raise'>('raise');
}

const MODE_ICONS: Readonly<Record<string, string>> = {
  off: 'power',
  cool: 'snowflake',
  heat: 'fire',
  heat_cool: 'sun-snowflake-variant',
  auto: 'autorenew',
  dry: 'water-percent',
  fan_only: 'fan',
};

/** Air conditioning and heating: the room temperature big, − / + around the target, then the modes. */
export function ClimateMain({ capability: climate, power, kit }: { capability: ClimateCapability; power?: PowerCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [side, setSide] = useStepSide();
  const [rangeSide, setRangeSide] = useState<{ end: 'low' | 'high'; side: 'lower' | 'raise' }>({ end: 'low', side: 'raise' });
  const { unit, step, min, max } = climate;
  const offMode = climate.modes.includes('off');
  const on = power ? power.value === 'on' : climate.mode !== 'off';
  const targetKey = keyOf(climate, 'set_temperature');
  const rangeKey = keyOf(climate, 'set_temperature_range');
  const powerKey = `${climate.entityId}:climate:power`;
  const modes = climate.modes.filter((mode) => !((power || offMode) && mode === 'off'));
  const modeChoices: Choice[] = modes.map((mode) => ({ value: mode, label: climateModeLabel(mode, climate.modes), icon: MODE_ICONS[mode] ?? 'thermostat' }));
  const low = climate.targetLow;
  const high = climate.targetHigh;

  return (
    <View style={styles.block}>
      {climate.current !== null ? (
        <Figure
          caption="In the room now"
          value={temperatureText(climate.current, unit)}
          extra={climate.currentHumidity !== null ? `Humidity ${percentText(climate.currentHumidity)}` : null}
        />
      ) : null}
      {climate.target !== null ? (
        <Stepper
          label="temperature"
          caption="Set to"
          valueText={temperatureText(climate.target, unit)}
          lowerLabel="Cooler"
          raiseLabel="Warmer"
          large={climate.current === null}
          canLower={climate.target > min}
          canRaise={climate.target < max}
          busy={kit.isBusy(targetKey) ? side : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onStep={(direction) => {
            setSide(direction > 0 ? 'raise' : 'lower');
            kit.send(climate, 'set_temperature', stepValue(climate.target ?? min, direction, step, min, max), targetKey);
          }}
        />
      ) : low !== null && high !== null ? (
        <>
          {(['low', 'high'] as const).map((end) => {
            const value = end === 'low' ? low : high;
            return (
              <Stepper
                key={end}
                label={end === 'low' ? 'heating temperature' : 'cooling temperature'}
                caption={end === 'low' ? 'Heat up to' : 'Cool down to'}
                valueText={temperatureText(value, unit)}
                lowerLabel="Lower"
                raiseLabel="Higher"
                canLower={end === 'low' ? low > min : high - step > low}
                canRaise={end === 'low' ? low + step < high : high < max}
                busy={kit.isBusy(rangeKey) && rangeSide.end === end ? rangeSide.side : null}
                disabled={kit.disabled}
                waiting={kit.waiting}
                onStep={(direction) => {
                  setRangeSide({ end, side: direction > 0 ? 'raise' : 'lower' });
                  const next =
                    end === 'low'
                      ? { low: stepValue(low, direction, step, min, high - step), high }
                      : { low, high: stepValue(high, direction, step, low + step, max) };
                  kit.send(climate, 'set_temperature_range', next, rangeKey);
                }}
              />
            );
          })}
        </>
      ) : null}
      {power ? (
        <PowerToggle capability={power} kit={kit} size="large" />
      ) : offMode ? (
        <ControlButton
          label={on ? 'On' : 'Off'}
          caption={on ? 'Tap to turn off' : 'Tap to turn on'}
          icon="power"
          selected={on}
          busy={kit.isBusy(powerKey)}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Turn ${on ? 'off' : 'on'} ${kit.deviceName}`}
          accessibilityValueText={on ? 'On' : 'Off'}
          onPress={() => {
            const command = climatePowerCommand(climate.modes, climate.entityId, !on);
            if (command) kit.send(climate, 'set_mode', command.value, powerKey);
          }}
        />
      ) : null}
      <ChoiceGroup
        label="Mode"
        choices={modeChoices}
        selected={climate.mode}
        busyValue={busyValue(kit, climate, 'set_mode', modes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(climate, 'set_mode', mode)}
      />
    </View>
  );
}

/**
 * A speaker or other player (a TV gets TvRemote): Power, Volume − / Mute / Volume +,
 * Previous / Play / Next, then where it plays from. While it is off every key stays in view,
 * greyed, with Power the one that works, so nobody wonders where the rest went.
 */
export function MediaMain({ capability: media, power, kit }: { capability: MediaCapability; power?: PowerCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const off = power?.value === 'off' || media.state === 'off';
  const keysOff = kit.disabled || off;
  const down = volumeCommand(media, -1);
  const up = volumeCommand(media, 1);
  const playPause = playPauseAction(media);
  const playing = media.state === 'playing' || media.state === 'buffering';
  const showAll = off;
  const nowPlaying = [media.title, media.artist].filter(Boolean).join(' · ');
  const volumeKey = (direction: 1 | -1) => keyOf(media, direction > 0 ? 'volume_up' : 'volume_down');
  const muteKey = keyOf(media, 'mute');
  const playKey = keyOf(media, 'play_pause');

  return (
    <View style={styles.block}>
      {nowPlaying || media.source ? (
        <AppText variant="controlCaption" color={theme.colors.textSupport} align="center" accessibilityLiveRegion="polite">
          {[nowPlaying, media.source ? `From ${sourceLabel(media.source)}` : null].filter(Boolean).join('  ·  ')}
        </AppText>
      ) : null}
      {power ? <PowerToggle capability={power} kit={kit} size="large" enabledOffline /> : null}
      {off ? (
        <AppText variant="controlLabel" align="center">
          Turn it on to use these controls.
        </AppText>
      ) : null}

      {showAll || down || media.muted !== null ? (
        <View style={styles.row}>
          {showAll || down ? (
            <ControlButton
              label="Volume −"
              icon="volume-minus"
              size="key"
              accessibilityLabel="Volume down"
              busy={kit.isBusy(volumeKey(-1))}
              disabled={keysOff || !down}
              waiting={kit.waiting}
              onPress={() => down && kit.send(media, down.action, down.value, volumeKey(-1))}
              style={styles.flex}
            />
          ) : null}
          {showAll || media.muted !== null ? (
            <ControlButton
              label={media.muted ? 'Unmute' : 'Mute'}
              icon={media.muted ? 'volume-off' : 'volume-mute'}
              size="key"
              selected={media.muted === true}
              busy={kit.isBusy(muteKey)}
              disabled={keysOff || media.muted === null}
              waiting={kit.waiting}
              onPress={() => kit.send(media, 'mute', !media.muted, muteKey)}
              style={styles.flex}
            />
          ) : null}
          {showAll || up ? (
            <ControlButton
              label="Volume +"
              icon="volume-plus"
              size="key"
              accessibilityLabel="Volume up"
              busy={kit.isBusy(volumeKey(1))}
              disabled={keysOff || !up}
              waiting={kit.waiting}
              onPress={() => up && kit.send(media, up.action, up.value, volumeKey(1))}
              style={styles.flex}
            />
          ) : null}
        </View>
      ) : null}

      {showAll || media.canPrevious || playPause || media.canNext ? (
        <View style={styles.row}>
          {showAll || media.canPrevious ? (
            <ControlButton
              label="Previous"
              icon="skip-previous"
              size="key"
              busy={kit.isBusy(keyOf(media, 'previous'))}
              disabled={keysOff || !media.canPrevious}
              waiting={kit.waiting}
              onPress={() => kit.send(media, 'previous')}
              style={styles.flex}
            />
          ) : null}
          {showAll || playPause ? (
            <ControlButton
              label={playing ? 'Pause' : 'Play'}
              icon={playing ? 'pause' : 'play'}
              size="key"
              busy={kit.isBusy(playKey)}
              disabled={keysOff || !playPause}
              waiting={kit.waiting}
              onPress={() => playPause && kit.send(media, playPause, undefined, playKey)}
              style={styles.flex}
            />
          ) : null}
          {showAll || media.canNext ? (
            <ControlButton
              label="Next"
              icon="skip-next"
              size="key"
              busy={kit.isBusy(keyOf(media, 'next'))}
              disabled={keysOff || !media.canNext}
              waiting={kit.waiting}
              onPress={() => kit.send(media, 'next')}
              style={styles.flex}
            />
          ) : null}
        </View>
      ) : null}

      <ChoiceGroup
        label="Watch or listen from"
        choices={media.sources.map((source) => ({ value: source, label: sourceLabel(source) }))}
        selected={media.source}
        busyValue={busyValue(kit, media, 'select_source', media.sources)}
        disabled={keysOff}
        waiting={kit.waiting}
        onPick={(source) => kit.send(media, 'select_source', source)}
      />
    </View>
  );
}

const OPEN_CLOSE_ICONS = {
  cover: { open: 'arrow-up', close: 'arrow-down' },
  valve: { open: 'valve-open', close: 'valve-closed' },
} as const;

/** Curtains, blinds and valves: big Open / Stop / Close, and how far open when it can say. */
export function OpenCloseMain({ capability, kit }: { capability: CoverCapability | ValveCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const icons = OPEN_CLOSE_ICONS[capability.type];
  const opened = capability.state === 'open' || capability.state === 'opening';
  const closed = capability.state === 'closed' || capability.state === 'closing';
  const button = (action: 'open' | 'stop' | 'close') => (
    <ControlButton
      key={action}
      label={action === 'open' ? 'Open' : action === 'close' ? 'Close' : 'Stop'}
      icon={action === 'stop' ? 'stop' : icons[action]}
      size="key"
      selected={action === 'open' ? opened : action === 'close' ? closed : false}
      busy={kit.isBusy(keyOf(capability, action))}
      disabled={kit.disabled}
      waiting={kit.waiting}
      accessibilityLabel={`${action === 'open' ? 'Open' : action === 'close' ? 'Close' : 'Stop'} ${kit.deviceName}`}
      onPress={() => kit.send(capability, action)}
      style={styles.flex}
    />
  );
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {button('open')}
        {capability.canStop ? button('stop') : null}
        {button('close')}
      </View>
      {capability.canPosition ? (
        <LevelSlider
          label="How far open"
          value={capability.position ?? 0}
          min={0}
          max={100}
          step={5}
          nudge={10}
          format={openAmountLabel}
          busy={kit.isBusy(keyOf(capability, 'set_position'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onCommit={(value) => kit.send(capability, 'set_position', value, keyOf(capability, 'set_position'))}
        />
      ) : null}
    </View>
  );
}

/** A robot vacuum: big Start and Pause, Send back to dock. Its battery is in the state line above ("· battery 87%"). */
export function VacuumMain({ capability: vacuum, kit }: { capability: VacuumCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const home = vacuum.state === 'docked' || vacuum.state === 'returning';
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <ControlButton
          label="Start"
          icon="play"
          size="key"
          selected={vacuum.state === 'cleaning'}
          busy={kit.isBusy(keyOf(vacuum, 'start'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Start cleaning with ${kit.deviceName}`}
          onPress={() => kit.send(vacuum, 'start')}
          style={styles.flex}
        />
        {vacuum.canPause ? (
          <ControlButton
            label="Pause"
            icon="pause"
            size="key"
            selected={vacuum.state === 'paused'}
            busy={kit.isBusy(keyOf(vacuum, 'pause'))}
            disabled={kit.disabled}
            waiting={kit.waiting}
            accessibilityLabel={`Pause ${kit.deviceName}`}
            onPress={() => kit.send(vacuum, 'pause')}
            style={styles.flex}
          />
        ) : null}
      </View>
      {vacuum.canReturn ? (
        <ControlButton
          label="Send back to dock"
          icon="home-import-outline"
          selected={home}
          busy={kit.isBusy(keyOf(vacuum, 'return_to_base'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Send ${kit.deviceName} back to its dock`}
          onPress={() => kit.send(vacuum, 'return_to_base')}
        />
      ) : null}
    </View>
  );
}

/** A robot lawn mower: Start, Pause, Dock. */
export function MowerMain({ capability: mower, kit }: { capability: MowerCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.row}>
      <ControlButton
        label="Start"
        icon="play"
        size="key"
        selected={mower.state === 'mowing'}
        busy={kit.isBusy(keyOf(mower, 'start'))}
        disabled={kit.disabled}
        waiting={kit.waiting}
        accessibilityLabel={`Start mowing with ${kit.deviceName}`}
        onPress={() => kit.send(mower, 'start')}
        style={styles.flex}
      />
      {mower.canPause ? (
        <ControlButton
          label="Pause"
          icon="pause"
          size="key"
          selected={mower.state === 'paused'}
          busy={kit.isBusy(keyOf(mower, 'pause'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Pause ${kit.deviceName}`}
          onPress={() => kit.send(mower, 'pause')}
          style={styles.flex}
        />
      ) : null}
      {mower.canDock ? (
        <ControlButton
          label="Dock"
          icon="home-import-outline"
          size="key"
          selected={mower.state === 'docked' || mower.state === 'returning'}
          busy={kit.isBusy(keyOf(mower, 'dock'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Send ${kit.deviceName} back to its dock`}
          onPress={() => kit.send(mower, 'dock')}
          style={styles.flex}
        />
      ) : null}
    </View>
  );
}

/** A door lock: big Lock and Unlock, Open when it unlatches. Unlock and Open ask first. */
export function LockMain({ capability: lock, kit }: { capability: LockCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [confirming, setConfirming] = useState<'unlock' | 'open' | null>(null);
  const locked = isLocked(lock.value);
  const unlocked = lock.value === 'unlocked' || lock.value === 'unlocking';
  const send = (action: 'lock' | 'unlock' | 'open') => {
    setConfirming(null);
    kit.send(lock, action);
  };
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <ControlButton
          label="Lock"
          icon="lock"
          size="key"
          selected={locked}
          busy={kit.isBusy(keyOf(lock, 'lock'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Lock ${kit.deviceName}`}
          onPress={() => send('lock')}
          style={styles.flex}
        />
        <ControlButton
          label="Unlock"
          icon="lock-open-variant"
          size="key"
          selected={unlocked}
          busy={kit.isBusy(keyOf(lock, 'unlock'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Unlock ${kit.deviceName}`}
          accessibilityHint="Asks you to confirm first"
          onPress={() => setConfirming('unlock')}
          style={styles.flex}
        />
      </View>
      {lock.canOpen ? (
        <ControlButton
          label="Open the door"
          icon="door-open"
          selected={lock.value === 'open' || lock.value === 'opening'}
          busy={kit.isBusy(keyOf(lock, 'open'))}
          disabled={kit.disabled}
          waiting={kit.waiting}
          accessibilityLabel={`Open ${kit.deviceName}`}
          accessibilityHint="Unlatches the door. Asks you to confirm first"
          onPress={() => setConfirming('open')}
        />
      ) : null}
      {confirming ? (
        <ConfirmStep
          question={confirming === 'unlock' ? `Unlock ${kit.deviceName}?` : `Open ${kit.deviceName}?`}
          detail={confirming === 'unlock' ? 'Anyone at the door can then open it.' : 'This unlatches the door so it can be pushed open.'}
          confirmLabel={confirming === 'unlock' ? 'Yes, unlock' : 'Yes, open'}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onConfirm={() => send(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </View>
  );
}

const ALARM_ICONS: Readonly<Record<string, string>> = {
  home: 'shield-home',
  away: 'shield-lock',
  night: 'weather-night',
  vacation: 'beach',
  custom_bypass: 'shield-check',
};

/** A security alarm: one button per way to arm it, and Disarm, which asks first. A code field when the panel wants one. */
export function AlarmMain({ capability: alarm, kit }: { capability: AlarmCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const needsCode = alarm.codeRequired && code.trim() === '';
  const withCode = (value: Record<string, unknown>) => (alarm.codeRequired ? { ...value, code: code.trim() } : value);
  const disarmKey = keyOf(alarm, 'disarm');
  return (
    <View style={styles.block}>
      {alarm.state === 'triggered' ? (
        <View style={styles.inline} accessibilityRole="alert">
          <AppIcon set="material" name="alarm-light" size={22} color={theme.colors.error} />
          <AppText variant="controlLabel" color={theme.colors.error}>
            The alarm is going off.
          </AppText>
        </View>
      ) : null}
      {alarm.codeRequired ? (
        <>
          <AppInput
            variant="field"
            label="Alarm code"
            value={code}
            onChangeText={setCode}
            secureTextEntry
            keyboardType="number-pad"
            autoComplete="off"
            height={theme.layout.deviceControl.button}
            accessibilityLabel="Alarm code"
          />
          {needsCode ? (
            <AppText variant="controlCaption" color={theme.colors.textSupport}>
              Type the alarm code first, then choose.
            </AppText>
          ) : null}
        </>
      ) : null}
      <View style={styles.row}>
        {alarm.modes.map((mode) => (
          <ControlButton
            key={mode}
            label={alarmModeLabel(mode)}
            icon={ALARM_ICONS[mode] ?? 'shield-outline'}
            size="key"
            selected={alarm.state === alarmModeState(mode)}
            busy={kit.isBusy(keyOf(alarm, 'arm', mode))}
            disabled={kit.disabled || needsCode}
            waiting={kit.waiting}
            accessibilityLabel={`${alarmModeLabel(mode)}: ${kit.deviceName}`}
            onPress={() => {
              kit.send(alarm, 'arm', withCode({ mode }), keyOf(alarm, 'arm', mode));
              setCode('');
            }}
            style={styles.chip}
          />
        ))}
        <ControlButton
          label="Disarm"
          icon="shield-off-outline"
          size="key"
          selected={alarm.state === 'disarmed'}
          busy={kit.isBusy(disarmKey)}
          disabled={kit.disabled || needsCode}
          waiting={kit.waiting}
          accessibilityLabel={`Disarm ${kit.deviceName}`}
          accessibilityHint="Turns the alarm off. Asks you to confirm first"
          onPress={() => setConfirming(true)}
          style={styles.chip}
        />
      </View>
      {confirming ? (
        <ConfirmStep
          question="Turn the alarm off?"
          detail="Nothing will warn you about a break-in until it is armed again."
          confirmLabel="Yes, disarm"
          disabled={kit.disabled || needsCode}
          waiting={kit.waiting}
          onConfirm={() => {
            setConfirming(false);
            kit.send(alarm, 'disarm', withCode({}), disarmKey);
            setCode('');
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </View>
  );
}

/** One press of − / + on a humidity target: the 1% Home Assistant takes is too fine to tap through. */
export const HUMIDITY_STEP = 5;

/** A humidifier: the room's humidity big, − / + around the target, its modes. */
export function HumidifierMain({ capability: humidifier, power, kit }: { capability: HumidifierCapability; power?: PowerCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [side, setSide] = useStepSide();
  const key = keyOf(humidifier, 'set_humidity');
  return (
    <View style={styles.block}>
      {humidifier.current !== null ? <Figure caption="Humidity in the room now" value={percentText(humidifier.current)} /> : null}
      {humidifier.target !== null ? (
        <Stepper
          label="humidity"
          caption="Set to"
          valueText={percentText(humidifier.target)}
          lowerLabel="Drier"
          raiseLabel="More moist"
          large={humidifier.current === null}
          canLower={humidifier.target > humidifier.min}
          canRaise={humidifier.target < humidifier.max}
          busy={kit.isBusy(key) ? side : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onStep={(direction) => {
            setSide(direction > 0 ? 'raise' : 'lower');
            kit.send(humidifier, 'set_humidity', stepValue(humidifier.target ?? humidifier.min, direction, HUMIDITY_STEP, humidifier.min, humidifier.max), key);
          }}
        />
      ) : null}
      {power ? <PowerToggle capability={power} kit={kit} size="large" /> : null}
      <ChoiceGroup
        label="Mode"
        choices={humidifier.modes.map((mode) => ({ value: mode, label: presetLabel(mode) }))}
        selected={humidifier.mode}
        busyValue={busyValue(kit, humidifier, 'set_mode', humidifier.modes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(humidifier, 'set_mode', mode)}
      />
    </View>
  );
}

/** A water heater: the water's temperature big, − / + around the target, its modes. */
export function WaterHeaterMain({ capability: heater, power, kit }: { capability: WaterHeaterCapability; power?: PowerCapability; kit: ControlKit }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [side, setSide] = useStepSide();
  const key = keyOf(heater, 'set_temperature');
  return (
    <View style={styles.block}>
      {heater.current !== null ? <Figure caption="Water now" value={temperatureText(heater.current, heater.unit)} /> : null}
      {heater.target !== null ? (
        <Stepper
          label="water temperature"
          caption="Set to"
          valueText={temperatureText(heater.target, heater.unit)}
          lowerLabel="Cooler"
          raiseLabel="Hotter"
          large={heater.current === null}
          canLower={heater.target > heater.min}
          canRaise={heater.target < heater.max}
          busy={kit.isBusy(key) ? side : null}
          disabled={kit.disabled}
          waiting={kit.waiting}
          onStep={(direction) => {
            setSide(direction > 0 ? 'raise' : 'lower');
            kit.send(heater, 'set_temperature', stepValue(heater.target ?? heater.min, direction, 1, heater.min, heater.max), key);
          }}
        />
      ) : null}
      {power ? <PowerToggle capability={power} kit={kit} size="large" /> : null}
      <ChoiceGroup
        label="Mode"
        choices={heater.modes.map((mode) => ({ value: mode, label: waterHeaterModeLabel(mode) }))}
        selected={heater.mode}
        busyValue={busyValue(kit, heater, 'set_mode', heater.modes)}
        disabled={kit.disabled}
        waiting={kit.waiting}
        onPick={(mode) => kit.send(heater, 'set_mode', mode)}
      />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: {
      gap: theme.spacing.md - theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    inline: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
    chip: {
      flexGrow: 1,
      flexBasis: theme.layout.deviceControl.chipBasis,
    },
    figure: {
      alignItems: 'center',
    },
  });
}
