/**
 * Behaviour checks for device controls: the everyday words values are shown in, which control
 * a device gets at the top of its screen and which go under "More controls" / "More settings",
 * what each button sends, the result shown before the hub answers, and how a CUBE gateway
 * device becomes the same model (and its commands go back).
 *
 *   npm run check:home
 */

import type { Capability, Command, Device, DeviceKind, MediaCapability } from '../../../types/home.types';
import type { GatewayCapability, GatewayDevice, GatewaySetting } from '../../../types/gateway.types';
import { toAppDevice, toGatewayCommand } from '../../gateway/services/deviceMapping';
import { applyOptimistic, kindGlyph, kindLabel, stateLine, toggleCommand } from './capabilities';
import {
  climatePowerCommand,
  currentFanSpeed,
  fanSpeeds,
  hasExtras,
  numberLayout,
  optionsLayout,
  planControls,
  playPauseAction,
  remoteKeyOf,
  stepValue,
  volumeCommand,
} from './controlPlan';
import {
  alarmModeLabel,
  alarmStateLabel,
  climateModeLabel,
  colorTempLabel,
  fanModeLabel,
  formatNumber,
  lockStateLabel,
  mowerStateLabel,
  openAmountLabel,
  optionLabel,
  presetLabel,
  problemAdvice,
  repeatLabel,
  sourceLabel,
  swingLabel,
  temperatureText,
  titleCase,
  vacuumStateLabel,
} from './deviceLabels';

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

// ---- fixtures ---------------------------------------------------------------------------------

const device = (kind: DeviceKind, capabilities: Capability[], fields: Partial<Device> = {}): Device => ({
  id: 'd1',
  name: 'Living room light',
  roomId: 'r1',
  room: 'Living room',
  kind,
  manufacturer: null,
  model: null,
  integration: null,
  accountId: null,
  online: true,
  capabilities,
  sensors: [],
  pending: null,
  lastChanged: null,
  lastError: null,
  ...fields,
});

const power = (value: 'on' | 'off' | 'unknown' = 'on', entityId = 'light.x'): Capability => ({ type: 'power', entityId, label: 'Power', value });

const climate = (fields: Record<string, unknown> = {}): Capability =>
  ({
    type: 'climate',
    entityId: 'climate.ac',
    label: 'AC',
    current: 21,
    target: 23,
    targetLow: null,
    targetHigh: null,
    min: 16,
    max: 30,
    step: 0.5,
    unit: '°C',
    mode: 'cool',
    modes: ['off', 'cool', 'heat', 'heat_cool', 'dry', 'fan_only'],
    fanMode: null,
    fanModes: [],
    presetMode: null,
    presetModes: [],
    swingMode: null,
    swingModes: [],
    currentHumidity: null,
    targetHumidity: null,
    minHumidity: 30,
    maxHumidity: 70,
    ...fields,
  }) as Capability;

const media = (fields: Partial<MediaCapability> = {}): MediaCapability => ({
  type: 'media',
  entityId: 'media_player.tv',
  label: 'TV',
  state: 'playing',
  volume: 0.5,
  muted: false,
  title: null,
  artist: null,
  source: null,
  sources: [],
  soundMode: null,
  soundModes: [],
  shuffle: null,
  repeat: null,
  canPlay: true,
  canPause: true,
  canStop: false,
  canNext: true,
  canPrevious: true,
  canVolumeStep: false,
  ...fields,
});

const press = (entityId: string, fields: Partial<Capability> = {}): Capability => ({ type: 'press', entityId, label: entityId, ...fields }) as Capability;

const send = (target: Device, command: Command) => applyOptimistic(target, command).capabilities;

const gatewayCapability = (fields: Partial<GatewayCapability>): GatewayCapability => ({
  key: 'media',
  type: 'media',
  label: 'TV',
  confirmed: true,
  updated_at: null,
  value: null,
  min: null,
  max: null,
  step: null,
  current: null,
  target: null,
  unit: null,
  mode: null,
  modes: [],
  fan_mode: null,
  fan_modes: [],
  volume: null,
  muted: null,
  source: null,
  sources: [],
  state: null,
  percentage: null,
  preset: null,
  presets: [],
  position: null,
  ...fields,
});

const button = (key: string, name: string): GatewaySetting => ({
  key,
  kind: 'button',
  name,
  value: null,
  options: [],
  min: null,
  max: null,
  step: null,
  unit: null,
  available: true,
  requires: null,
  description: null,
  diagnostic: false,
  confirmed: true,
});

const gatewayTv = (commands: string[], capabilities: GatewayCapability[], settings: GatewaySetting[] = []): GatewayDevice => ({
  id: 'tv1',
  name: 'LG TV',
  brand: 'LG',
  model: null,
  adapter_id: 'webos',
  category: 'tv',
  room_id: null,
  room: null,
  ip: '192.168.1.40',
  mac: null,
  unique_id: 'u1',
  protocol: 'webos',
  experimental: false,
  dashboard: true,
  connection: { status: 'connected', last_seen: null, last_error: null, retry_at: null },
  capabilities,
  readings: [],
  settings,
  commands,
  pending: null,
  created_at: 0,
  updated_at: 0,
});

// ---- checks -----------------------------------------------------------------------------------

const checks: [string, () => void][] = [
  [
    'AC modes read in everyday words',
    () => {
      equal(climateModeLabel('heat_cool'), 'Auto', 'heat_cool');
      equal(climateModeLabel('fan_only'), 'Fan only', 'fan_only');
      equal(climateModeLabel('dry'), 'Dry', 'dry');
      equal(climateModeLabel('off'), 'Off', 'off');
      equal(climateModeLabel('auto'), 'Auto', 'auto alone');
      equal(climateModeLabel('auto', ['heat_cool', 'auto']), 'Smart', 'auto beside heat_cool never reads "Auto" twice');
    },
  ],
  [
    'presets, fan speeds and swing read in everyday words',
    () => {
      equal(['eco', 'away', 'boost', 'comfort', 'home', 'sleep', 'none'].map(presetLabel), ['Eco', 'Away', 'Boost', 'Comfort', 'Home', 'Sleep', 'Normal']);
      equal(['low', 'medium', 'high', 'auto'].map(fanModeLabel), ['Low', 'Medium', 'High', 'Auto']);
      equal(['vertical', 'horizontal', 'both'].map(swingLabel), ['Up and down', 'Side to side', 'Both ways']);
    },
  ],
  [
    'a vacuum, a mower, an alarm and a lock say what they are doing',
    () => {
      equal(['docked', 'cleaning', 'returning', 'error'].map(vacuumStateLabel), ['On its dock', 'Cleaning', 'Going back to its dock', 'Needs attention']);
      equal(mowerStateLabel('mowing'), 'Mowing');
      equal(['armed_home', 'disarmed', 'triggered'].map(alarmStateLabel), ['Armed (at home)', 'Off', 'Alarm!']);
      equal(['home', 'away'].map(alarmModeLabel), ['Arm home', 'Arm away']);
      equal(lockStateLabel('jammed'), 'Stuck: check the lock');
      equal(['off', 'one', 'all'].map(repeatLabel), ['Off', 'Repeat one', 'Repeat all']);
    },
  ],
  [
    'unknown values come out in title case with spaces',
    () => {
      equal(titleCase('low_power'), 'Low Power', 'snake case');
      equal(titleCase('hdmi1'), 'HDMI 1', 'numbered acronym');
      equal(optionLabel('night-light'), 'Night Light', 'kebab case');
      equal(vacuumStateLabel('mopping'), 'Mopping', 'state no table knows');
      equal(alarmStateLabel('unavailable'), 'Not responding', 'unavailable');
      equal(sourceLabel('Netflix'), 'Netflix', 'names stay');
      equal(sourceLabel('tv'), 'TV', 'identifiers reworded');
    },
  ],
  [
    'figures read plainly',
    () => {
      equal(formatNumber(22), '22');
      equal(formatNumber(22.5), '22.5');
      equal(temperatureText(21.0, '°C'), '21°');
      equal(temperatureText(300, 'K'), '300 K');
      equal(colorTempLabel(2700), 'Warm white · 2700 K');
      equal(colorTempLabel(6500), 'Cool white · 6500 K');
      equal([0, 40, 100].map(openAmountLabel), ['Closed', '40% open', 'Fully open']);
    },
  ],
  [
    'a failure says what to do',
    () => {
      equal(problemAdvice('Check that it is switched on.'), 'Check that it is switched on.', 'advice kept');
      equal(problemAdvice('The hub refused.').startsWith('The hub refused. Try again'), true, 'advice added');
      equal(problemAdvice('  '), 'That didn’t work. Try again in a moment.', 'empty');
    },
  ],
  [
    'a card says the state in words',
    () => {
      equal(stateLine(device('light', [power('on')], { online: false })), 'Not responding', 'offline');
      equal(stateLine(device('climate', [climate()])), 'Cool · 21° → 23°', 'climate');
      equal(stateLine(device('climate', [climate({ mode: 'off' })])), 'Off', 'climate off');
      equal(stateLine(device('light', [power('on'), { type: 'brightness', entityId: 'light.x', label: 'B', value: 40 }])), 'On · 40%', 'dimmed light');
      equal(stateLine(device('light', [power('unknown')])), 'Not known', 'unknown');
      const vacuum = { type: 'vacuum', entityId: 'vacuum.r', label: 'R', state: 'cleaning', battery: 80, fanSpeed: null, fanSpeeds: [], canPause: true, canStop: true, canReturn: true, canLocate: false, canSpot: false } as Capability;
      equal(stateLine(device('vacuum', [vacuum])), 'Cleaning · battery 80%', 'vacuum');
      equal(stateLine(device('media', [power('off', 'media_player.tv'), media()])), 'Off', 'TV switched off');
      equal(stateLine(device('media', [media({ state: 'off' })])), 'Off', 'player off without a power switch');
      equal(stateLine(device('media', [power('on', 'power'), media({ state: 'unknown' })])), 'On', 'TV that only knows it is on');
    },
  ],
  [
    'every device kind has an icon and a name',
    () => {
      (['vacuum', 'humidifier', 'water_heater', 'valve', 'alarm', 'mower'] as DeviceKind[]).forEach((kind) => {
        equal(Boolean(kindGlyph(kind).iconName), true, `${kind} icon`);
        equal(kindLabel(kind) !== 'Device', true, `${kind} name`);
      });
    },
  ],
  [
    'a light gets one big On/Off, its brightness goes under More controls',
    () => {
      const plan = planControls(device('light', [{ type: 'brightness', entityId: 'light.x', label: 'B', value: 40 }, power()]));
      equal(plan.main?.type, 'power', 'main');
      equal(plan.more.map((capability) => capability.type), ['brightness'], 'more');
    },
  ],
  [
    'an AC gets its temperature control on top with its power inside it; settings fold away',
    () => {
      const plan = planControls(
        device('climate', [power('on', 'switch.ac'), climate(), { type: 'option', entityId: 'select.light', label: 'Display light', value: 'on', options: ['on', 'off'], role: 'setting', advanced: true }]),
      );
      equal(plan.main?.type, 'climate', 'main');
      equal(plan.mainPower.length, 1, 'power inside the main control');
      equal(plan.more.length, 0, 'nothing else everyday');
      equal(plan.settings.map((capability) => capability.entityId), ['select.light'], 'settings');
    },
  ],
  [
    'a two-gang switch shows both outputs on top',
    () => {
      const plan = planControls(device('switch', [power('on', 'switch.a'), power('off', 'switch.b')]));
      equal([plan.main?.entityId, plan.mainPower.map((capability) => capability.entityId)], ['switch.a', ['switch.b']]);
    },
  ],
  [
    'a device of no particular kind still gets its obvious control; a sensor gets none',
    () => {
      equal(planControls(device('other', [{ type: 'lock', entityId: 'lock.door', label: 'Door', value: 'locked', canOpen: false }])).main?.type, 'lock', 'other with a lock');
      equal(planControls(device('sensor', [])).main, null, 'sensor');
    },
  ],
  [
    'a TV’s remote keys only ever go on its remote, never in a list of buttons',
    () => {
      const keys = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'menu', 'channel_up', 'channel_down', 'info', 'exit'].map((key) => press(key));
      const plan = planControls(device('media', [power('on', 'media_player.tv'), media(), ...keys, press('restart'), press('menu', { advanced: true } as Partial<Capability>)]));
      equal(plan.main?.type, 'media', 'main');
      equal(plan.remote.length, 13, 'every key on the remote, a settings one too');
      equal(plan.more.map((capability) => capability.entityId), ['restart'], 'other buttons stay plain');
      equal(plan.settings.length, 0, 'none under More settings');
      const powerOnly = planControls(device('media', [power('off', 'media_player.tv'), ...keys]));
      equal([powerOnly.main?.type, powerOnly.remote.length, powerOnly.more.length], ['power', 12, 0], 'a TV that reports only power');
    },
  ],
  [
    'remote keys are recognised however the hub names them',
    () => {
      equal(['up', 'remote:ok', 'key_back', 'button.channel_up', 'power', 'restart'].map(remoteKeyOf), ['up', 'ok', 'back', 'channel_up', null, null]);
    },
  ],
  [
    'More controls opens with the main control’s own extras only when it has some',
    () => {
      equal(hasExtras(climate()), false, 'plain AC');
      equal(hasExtras(climate({ fanModes: ['low', 'high'] })), true, 'AC with fan speeds');
      equal(hasExtras(media({ volume: null })), false, 'TV without a volume level');
      equal(hasExtras(media()), true, 'TV with a volume level');
    },
  ],
  [
    'up to six choices are chips, more a list; a short number range gets − / +',
    () => {
      equal([optionsLayout(6), optionsLayout(7)], ['chips', 'list']);
      equal(numberLayout({ min: 0, max: 10, step: 1 }), 'stepper', 'ten steps');
      equal(numberLayout({ min: 0, max: 255, step: 1 }), 'slider', 'long range');
    },
  ],
  [
    'a step stays on the grid and inside the range',
    () => {
      equal(stepValue(21.5, 1, 0.5, 16, 30), 22);
      equal(stepValue(29.8, 1, 0.5, 16, 30), 30, 'clamped at the top');
      equal(stepValue(16, -1, 1, 16, 30), 16, 'clamped at the bottom');
      equal(stepValue(47, 1, 5, 30, 80), 50, 'back onto the grid');
    },
  ],
  [
    'a three-speed fan gets Low / Medium / High',
    () => {
      const speeds = fanSpeeds({ percentageStep: 33.33 });
      equal(speeds, [
        { label: 'Low', percentage: 33 },
        { label: 'Medium', percentage: 67 },
        { label: 'High', percentage: 100 },
      ]);
      equal(currentFanSpeed(speeds ?? [], 70)?.label, 'Medium', 'nearest speed');
      equal(currentFanSpeed(speeds ?? [], 0), null, 'off');
      equal(fanSpeeds({ percentageStep: 1 }), null, 'a slider for many speeds');
    },
  ],
  [
    'Volume − / + use the device’s step, else move the level 5%',
    () => {
      equal(volumeCommand(media({ canVolumeStep: true }), 1), { action: 'volume_up' }, 'own step');
      equal(volumeCommand(media({ volume: 0.5 }), -1), { action: 'set_volume', value: 0.45 }, 'level');
      equal(volumeCommand(media({ volume: 0.98 }), 1), { action: 'set_volume', value: 1 }, 'capped');
      equal(volumeCommand(media({ volume: null }), 1), null, 'neither');
    },
  ],
  [
    'Play / Pause sends what fits the player',
    () => {
      equal(playPauseAction(media({ state: 'playing' })), 'pause');
      equal(playPauseAction(media({ state: 'paused' })), 'play');
      equal(playPauseAction(media({ state: 'unknown' })), 'play_pause', 'state not known');
      equal(playPauseAction(media({ state: 'playing', canPause: false, canStop: false })), null, 'cannot');
    },
  ],
  [
    'an AC without a power switch turns on in its usual mode and off with its off mode',
    () => {
      equal(climatePowerCommand(['off', 'heat', 'cool'], 'climate.ac', true), { capability: 'climate', action: 'set_mode', value: 'cool', entityId: 'climate.ac' });
      equal(climatePowerCommand(['off', 'heat'], 'climate.ac', false)?.value, 'off');
      equal(climatePowerCommand(['heat', 'cool'], 'climate.ac', true), null, 'no off mode');
      equal(toggleCommand(device('climate', [climate()]), true), { capability: 'climate', action: 'set_mode', value: 'cool' }, 'card switch unchanged');
      equal(toggleCommand(device('light', [power('off')]), true), { capability: 'power', action: 'on' }, 'light card switch');
    },
  ],
  [
    'the AC shows the new preset, swing, humidity and range at once',
    () => {
      const ac = device('climate', [climate()]);
      const read = (command: Partial<Command>) => send(ac, { capability: 'climate', ...command } as Command)[0] as Extract<Capability, { type: 'climate' }>;
      equal(read({ action: 'set_preset', value: 'eco' }).presetMode, 'eco');
      equal(read({ action: 'set_swing_mode', value: 'vertical' }).swingMode, 'vertical');
      equal(read({ action: 'set_humidity', value: 45 }).targetHumidity, 45);
      const range = read({ action: 'set_temperature_range', value: { low: 20, high: 24 } });
      equal([range.targetLow, range.targetHigh], [20, 24]);
      equal(applyOptimistic(ac, { capability: 'climate', action: 'set_mode', value: 'heat' }).pending, { entityId: '', capability: 'climate', action: 'set_mode' }, 'pending');
    },
  ],
  [
    'a fan, a cover and a light show their new state at once',
    () => {
      const fan = device('fan', [power('off', 'fan.f'), { type: 'fan', entityId: 'fan.f', label: 'F', percentage: 0, percentageStep: 33.33, presetMode: null, presetModes: [], oscillating: false, direction: 'forward' }]);
      const spun = send(fan, { capability: 'fan', action: 'set_percentage', value: 67, entityId: 'fan.f' });
      equal([(spun[0] as { value: string }).value, (spun[1] as { percentage: number }).percentage], ['on', 67], 'speed also switches it on');
      equal((send(fan, { capability: 'fan', action: 'set_oscillating', value: true })[1] as { oscillating: boolean }).oscillating, true);
      equal((send(fan, { capability: 'fan', action: 'set_direction', value: 'reverse' })[1] as { direction: string }).direction, 'reverse');
      const blind = device('cover', [{ type: 'cover', entityId: 'cover.b', label: 'B', position: 0, state: 'closed', canPosition: true, canStop: true, tilt: 0, canTilt: true, canSetTilt: true }]);
      equal((send(blind, { capability: 'cover', action: 'set_tilt', value: 50 })[0] as { tilt: number }).tilt, 50, 'tilt');
      equal((send(blind, { capability: 'cover', action: 'open' })[0] as { state: string }).state, 'opening', 'open');
      const bulb = device('light', [{ type: 'color', entityId: 'light.x', label: 'C', value: null }]);
      equal((send(bulb, { capability: 'color', action: 'set', value: { h: 120, s: 100 } })[0] as { value: unknown }).value, { h: 120, s: 100 }, 'colour');
    },
  ],
  [
    'a TV shows play, pause, volume, shuffle, repeat and sound mode at once',
    () => {
      const tv = device('media', [media({ shuffle: false, repeat: 'off', soundModes: ['movie'] })]);
      const read = (action: string, value?: unknown) => send(tv, { capability: 'media', action, value })[0] as MediaCapability;
      equal(read('pause').state, 'paused');
      equal(read('play_pause').state, 'paused', 'play_pause while playing');
      equal(read('stop').state, 'idle');
      equal(read('volume_up').volume, 0.55);
      equal(read('set_shuffle', true).shuffle, true);
      equal(read('set_repeat', 'all').repeat, 'all');
      equal(read('select_sound_mode', 'movie').soundMode, 'movie');
    },
  ],
  [
    'settings, numbers and the newer devices show their result at once',
    () => {
      const select = device('other', [{ type: 'option', entityId: 'select.m', label: 'M', value: 'a', options: ['a', 'b'], role: 'setting' }]);
      equal((send(select, { capability: 'option', action: 'select', value: 'b' })[0] as { value: string }).value, 'b', 'option');
      equal((send(select, { capability: 'option', action: 'select', value: 'zzz' })[0] as { value: string }).value, 'a', 'unknown option ignored');
      const number = device('other', [{ type: 'number', entityId: 'number.n', label: 'N', value: 1, min: 0, max: 10, step: 0.5, unit: null }]);
      equal((send(number, { capability: 'number', action: 'set', value: 7.3 })[0] as { value: number }).value, 7.5, 'rounded to step');
      equal((send(number, { capability: 'number', action: 'set', value: 99 })[0] as { value: number }).value, 10, 'clamped');
      const vacuum = device('vacuum', [{ type: 'vacuum', entityId: 'vacuum.r', label: 'R', state: 'cleaning', battery: 50, fanSpeed: null, fanSpeeds: ['quiet'], canPause: true, canStop: true, canReturn: true, canLocate: true, canSpot: true }]);
      equal((send(vacuum, { capability: 'vacuum', action: 'return_to_base' })[0] as { state: string }).state, 'returning', 'vacuum');
      const heater = device('water_heater', [{ type: 'water_heater', entityId: 'water_heater.w', label: 'W', current: 40, target: 50, min: 30, max: 60, unit: '°C', mode: 'eco', modes: ['eco'], away: false }]);
      equal((send(heater, { capability: 'water_heater', action: 'set_away', value: true })[0] as { away: boolean }).away, true, 'water heater');
      equal((send(heater, { capability: 'water_heater', action: 'set_temperature', value: 99 })[0] as { target: number }).target, 60, 'water heater clamped');
      const humidifier = device('humidifier', [{ type: 'humidifier', entityId: 'humidifier.h', label: 'H', current: 40, target: 50, min: 30, max: 80, mode: null, modes: ['eco'] }]);
      equal((send(humidifier, { capability: 'humidifier', action: 'set_mode', value: 'eco' })[0] as { mode: string }).mode, 'eco', 'humidifier');
      const alarm = device('alarm', [{ type: 'alarm', entityId: 'alarm_control_panel.a', label: 'A', state: 'disarmed', modes: ['home', 'away'], codeRequired: true }]);
      equal((send(alarm, { capability: 'alarm', action: 'arm', value: { mode: 'away', code: '1234' } })[0] as { state: string }).state, 'arming', 'alarm');
      const mower = device('mower', [{ type: 'mower', entityId: 'lawn_mower.m', label: 'M', state: 'mowing', canPause: true, canDock: true }]);
      equal((send(mower, { capability: 'mower', action: 'dock' })[0] as { state: string }).state, 'returning', 'mower');
      const valve = device('valve', [{ type: 'valve', entityId: 'valve.v', label: 'V', position: null, state: 'closed', canPosition: false, canStop: false }]);
      equal((send(valve, { capability: 'valve', action: 'open' })[0] as { state: string }).state, 'opening', 'valve');
      const lock = device('lock', [{ type: 'lock', entityId: 'lock.door', label: 'Door', value: 'locked', canOpen: true }]);
      equal((send(lock, { capability: 'lock', action: 'open' })[0] as { value: string }).value, 'opening', 'lock open');
    },
  ],
  [
    'a gateway TV says only what its accepted commands can do',
    () => {
      const tv = toAppDevice(
        gatewayTv(
          ['turn_on', 'turn_off', 'media_play', 'media_pause', 'media_next', 'media_previous', 'volume_up', 'volume_down', 'mute'],
          [gatewayCapability({ key: 'power', type: 'power', value: 'on' }), gatewayCapability({ volume: 15, sources: ['HDMI 1'], state: 'on' })],
        ),
      );
      const capability = tv.capabilities.find((entry) => entry.type === 'media') as MediaCapability;
      equal(
        [capability.volume, capability.canVolumeStep, capability.muted, capability.sources, capability.canPlay, capability.canStop, capability.shuffle],
        [null, true, false, [], true, false, null],
        'no set_volume: no level; volume keys still work; no set_source: no inputs',
      );
    },
  ],
  [
    'a gateway TV’s remote buttons become press controls only when it accepts press',
    () => {
      const settings = [button('up', 'Up'), button('ok', 'OK'), button('menu', 'Settings')];
      const withPress = toAppDevice(gatewayTv(['turn_on', 'press'], [gatewayCapability({ key: 'power', type: 'power', value: 'on' })], settings));
      equal(
        withPress.capabilities.filter((entry) => entry.type === 'press').map((entry) => [entry.entityId, entry.label]),
        [
          ['up', 'Up'],
          ['ok', 'OK'],
          ['menu', 'Settings'],
        ],
      );
      const without = toAppDevice(gatewayTv(['turn_on'], [], settings));
      equal(without.capabilities.some((entry) => entry.type === 'press'), false, 'no press command, no buttons');
      equal(toGatewayCommand({ capability: 'press', action: 'press', entityId: 'ok' }, ['press']), { command: 'press', params: { key: 'ok' } }, 'press goes back with its key');
      equal(toGatewayCommand({ capability: 'press', action: 'press', entityId: 'ok' }, ['turn_on']), null, 'not accepted');
    },
  ],
  [
    'app actions the gateway has no command for fall back on one it accepts',
    () => {
      const tv = device('media', [power('on', 'power'), media({ entityId: 'media', volume: 0.5, state: 'playing' })]);
      equal(toGatewayCommand({ capability: 'media', action: 'volume_up', entityId: 'media' }, ['set_volume'], tv), { command: 'set_volume', params: { key: 'media', volume: 55 } }, 'volume_up as set_volume + 5');
      equal(toGatewayCommand({ capability: 'media', action: 'volume_down', entityId: 'media' }, ['volume_down', 'set_volume'], tv), { command: 'volume_down', params: { key: 'media' } }, 'its own key first');
      equal(toGatewayCommand({ capability: 'media', action: 'play_pause', entityId: 'media' }, ['media_play', 'media_pause'], tv)?.command, 'media_pause', 'play_pause while playing');
      equal(toGatewayCommand({ capability: 'media', action: 'stop', entityId: 'media' }, ['media_pause'], tv)?.command, 'media_pause', 'stop as pause');
      equal(toGatewayCommand({ capability: 'power', action: 'toggle', entityId: 'power' }, ['turn_on', 'turn_off'], tv)?.command, 'turn_off', 'toggle as turn_off');
      equal(toGatewayCommand({ capability: 'fan', action: 'set_preset', value: 'sleep', entityId: 'fan:0' }, ['set_fan_mode']), { command: 'set_fan_mode', params: { key: 'fan:0', fan_mode: 'sleep' } }, 'fan preset');
      equal(toGatewayCommand({ capability: 'media', action: 'set_shuffle', value: true }, ['media_play']), null, 'nothing to fall back on');
    },
  ],
];

let failed = 0;
checks.forEach(([name, check], index) => {
  try {
    check();
    console.log(`PASS  ${index + 1}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${index + 1}. ${name}\n        ${(error as Error).message}`);
  }
});
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exitCode = failed ? 1 : 0;
