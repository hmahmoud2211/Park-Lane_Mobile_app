import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { toDevice, toGatewayCommand, type GatewayDevice } from '../src/gateway/mapping.ts';
import { ASSISTANT_REFUSED, AUDITED, resolveCommand } from '../src/ha/commands.ts';
import { capabilitiesOf, toDevices, toRooms } from '../src/ha/mapping.ts';
import type { Capability, CommandRequest, Device, HaArea, HaDevice, HaEntity, HaState, Registries } from '../src/ha/types.ts';
import { demoHome, type FakeSetup } from './fakeHa.ts';

/** Home Assistant registries and states → Park-Lane devices, and the command allowlist. Pure, no network. */

function fixture(home: FakeSetup = demoHome()): { registries: Registries; states: Map<string, HaState> } {
  const registries: Registries = {
    areas: new Map(home.areas.map((area) => [area.area_id, { icon: null, ...area } as HaArea])),
    devices: new Map(
      home.devices.map((device) => [
        device.id,
        { name_by_user: null, manufacturer: null, model: null, area_id: null, config_entry_id: null, disabled_by: null, entry_type: null, ...device } as HaDevice,
      ]),
    ),
    entities: new Map(
      home.entities.map((entity) => [
        entity.entity_id,
        { area_id: null, platform: 'demo', name: null, original_name: null, entity_category: null, disabled_by: null, hidden_by: null, config_entry_id: null, ...entity } as HaEntity,
      ]),
    ),
  };
  const states = new Map(Object.entries(home.states).map(([id, state]) => [id, { state: state.s, attributes: state.a ?? {}, lastChanged: 100 }]));
  return { registries, states };
}

const byId = (devices: Device[], id: string) => {
  const found = devices.find((device) => device.id === id);
  assert.ok(found, `device ${id} missing from ${devices.map((device) => device.id).join(', ')}`);
  return found;
};

const st = (state: string, attributes: Record<string, unknown> = {}): HaState => ({ state, attributes, lastChanged: 1 });
const capsOf = (entityId: string, state: HaState) => capabilitiesOf(entityId, state, 'Thing');
function one<T extends Capability['type']>(caps: Capability[], type: T): Extract<Capability, { type: T }> {
  const found = caps.find((capability) => capability.type === type);
  assert.ok(found, `no ${type} in ${caps.map((capability) => capability.type).join(', ')}`);
  return found as Extract<Capability, { type: T }>;
}

/** A device with just these capabilities: resolveCommand only reads them. */
const deviceWith = (...capabilities: Capability[]): Device => ({
  id: 'd',
  name: 'Thing',
  roomId: null,
  room: null,
  kind: 'other',
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
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'no error';
};

describe('mapping', () => {
  const { registries, states } = fixture();
  const devices = toDevices(registries, states);

  test('shows real devices and lone helpers, and leaves out services, hidden and empty ones', () => {
    assert.deepEqual(devices.map((device) => device.id).sort(), [
      'dev-ac',
      'dev-alarm',
      'dev-blinds',
      'dev-light',
      'dev-lock',
      'dev-plug',
      'dev-sensor',
      'dev-tv',
      'dev-vacuum',
      'e.input_boolean.guest_mode',
    ]);
  });

  test('a colour-temperature light gets power, brightness and colour temperature, then its settings', () => {
    const light = byId(devices, 'dev-light');
    assert.equal(light.kind, 'light');
    assert.equal(light.room, 'Living Room');
    assert.equal(light.integration, 'tuya');
    assert.equal(light.accountId, 'entry-tuya');
    assert.deepEqual(
      light.capabilities.map((capability) => [capability.type, capability.advanced ?? false]),
      [
        ['power', false],
        ['brightness', false],
        ['color_temp', false],
        ['number', true],
      ],
    );
    const temp = light.capabilities.find((capability) => capability.type === 'color_temp');
    assert.equal(temp?.type === 'color_temp' && temp.min, 2700);
    assert.deepEqual(one(light.capabilities, 'number'), {
      entityId: 'number.ceiling_transition',
      label: 'Transition time',
      advanced: true,
      type: 'number',
      value: 1,
      min: 0,
      max: 10,
      step: 0.5,
      unit: 's',
    });
  });

  test('an outlet switch is a plug; its config entities are advanced settings and its sensor is kept', () => {
    const plug = byId(devices, 'dev-plug');
    assert.equal(plug.kind, 'plug');
    assert.deepEqual(
      plug.capabilities.map((capability) => [capability.entityId, capability.advanced ?? false]),
      [
        ['switch.plug', false],
        ['switch.plug_child_lock', true],
        ['select.plug_power_on', true],
      ],
    );
    assert.deepEqual(one(plug.capabilities, 'option'), {
      entityId: 'select.plug_power_on',
      label: 'Power-on behaviour',
      advanced: true,
      type: 'option',
      role: 'setting',
      value: 'previous',
      options: ['off', 'on', 'previous'],
    });
    assert.deepEqual(plug.sensors, [{ entityId: 'sensor.plug_power', label: 'Power', value: '0', unit: 'W', deviceClass: 'power' }]);
  });

  test('climate reads its range, modes, fan modes, presets, swing and humidity', () => {
    const ac = byId(devices, 'dev-ac').capabilities[0];
    assert.equal(ac.type, 'climate');
    if (ac.type === 'climate') {
      assert.equal(ac.target, 24);
      assert.deepEqual([ac.min, ac.max, ac.step], [16, 30, 1]);
      assert.deepEqual(ac.modes, ['off', 'cool', 'heat']);
      assert.deepEqual(ac.fanModes, ['low', 'high']);
      assert.deepEqual([ac.presetMode, ac.presetModes], ['none', ['none', 'eco', 'boost', 'sleep']]);
      assert.deepEqual([ac.swingMode, ac.swingModes], ['off', ['off', 'vertical', 'horizontal', 'both']]);
      assert.deepEqual([ac.currentHumidity, ac.targetHumidity, ac.minHumidity, ac.maxHumidity], [55, 50, 30, 70]);
      assert.deepEqual([ac.targetLow, ac.targetHigh], [null, null], 'no range feature');
    }
  });

  test('the demo TV, vacuum, blinds and alarm get their own kinds', () => {
    assert.deepEqual(
      ['dev-tv', 'dev-vacuum', 'dev-blinds', 'dev-alarm', 'dev-lock'].map((id) => byId(devices, id).kind),
      ['media', 'vacuum', 'cover', 'alarm', 'lock'],
    );
    assert.deepEqual(byId(devices, 'dev-tv').capabilities.map((capability) => capability.type), ['power', 'media']);
    assert.equal(one(byId(devices, 'dev-lock').capabilities, 'lock').canOpen, true);
  });

  test('a sensor-only device skips its diagnostic button', () => {
    const sensor = byId(devices, 'dev-sensor');
    assert.equal(sensor.kind, 'sensor');
    assert.equal(sensor.capabilities.length, 0);
    assert.equal(sensor.sensors[0].value, '22.5');
  });

  test('an entity without a device keeps its own name and area', () => {
    const helper = byId(devices, 'e.input_boolean.guest_mode');
    assert.equal(helper.name, 'Guest mode');
    assert.equal(helper.roomId, 'living_room');
    assert.equal(helper.kind, 'switch');
  });

  test('a renamed device uses the resident’s name; unavailable means offline', () => {
    const renamed = fixture();
    (renamed.registries.devices.get('dev-plug') as HaDevice).name_by_user = 'Kettle';
    renamed.states.set('switch.plug', { state: 'unavailable', attributes: {}, lastChanged: 5 });
    const plug = byId(toDevices(renamed.registries, renamed.states), 'dev-plug');
    assert.equal(plug.name, 'Kettle');
    assert.equal(plug.online, false, 'its settings do not keep it online');
  });

  test('rooms count their devices', () => {
    assert.deepEqual(
      toRooms(registries, devices).map((room) => [room.name, room.deviceCount]),
      [
        ['Bedroom', 3],
        ['Living Room', 5],
      ],
    );
  });
});

describe('config entities', () => {
  const home = (): FakeSetup => ({
    areas: [],
    devices: [
      { id: 'dev-socket', name: 'Socket' },
      { id: 'dev-settings', name: 'Bridge' },
    ],
    entities: [
      { entity_id: 'switch.socket', device_id: 'dev-socket' },
      // A plug's indicator LED is a config light: it must not make the plug a light.
      { entity_id: 'light.socket_indicator', device_id: 'dev-socket', entity_category: 'config' },
      { entity_id: 'button.socket_identify', device_id: 'dev-socket', entity_category: 'diagnostic' },
      { entity_id: 'select.socket_hidden', device_id: 'dev-socket', entity_category: 'config', hidden_by: 'user' },
      { entity_id: 'number.bridge_volume', device_id: 'dev-settings', entity_category: 'config' },
    ],
    states: {
      'switch.socket': { s: 'on', a: { device_class: 'outlet' } },
      'light.socket_indicator': { s: 'on', a: { supported_color_modes: ['onoff'] } },
      'button.socket_identify': { s: 'unknown' },
      'select.socket_hidden': { s: 'a', a: { options: ['a', 'b'] } },
      'number.bridge_volume': { s: '3', a: { min: 0, max: 10, step: 1 } },
    },
  });

  test('are advanced and never decide the kind; diagnostic and hidden ones stay out', () => {
    const { registries, states } = fixture(home());
    const socket = byId(toDevices(registries, states), 'dev-socket');
    assert.equal(socket.kind, 'plug');
    assert.deepEqual(
      socket.capabilities.map((capability) => [capability.entityId, capability.type, capability.advanced ?? false]),
      [
        ['switch.socket', 'power', false],
        ['light.socket_indicator', 'power', true],
      ],
    );
  });

  test('a device with only settings is shown as other', () => {
    const { registries, states } = fixture(home());
    const bridge = byId(toDevices(registries, states), 'dev-settings');
    assert.equal(bridge.kind, 'other');
    assert.equal(bridge.online, true);
    assert.deepEqual(bridge.capabilities.map((capability) => capability.advanced), [true]);
  });

  test('a command without an entityId goes to the everyday control, with one to the setting', () => {
    const { registries, states } = fixture(home());
    const socket = byId(toDevices(registries, states), 'dev-socket');
    assert.equal(resolveCommand(socket, { capability: 'power', action: 'off' }).call.entityId, 'switch.socket');
    assert.deepEqual(resolveCommand(socket, { capability: 'power', action: 'off', entityId: 'light.socket_indicator' }).call, {
      domain: 'light',
      service: 'turn_off',
      entityId: 'light.socket_indicator',
      data: {},
    });
  });
});

describe('capabilities by domain', () => {
  test('climate: each feature bit, and nothing without it', () => {
    const full = one(
      capsOf(
        'climate.t',
        st('heat_cool', {
          supported_features: 1 | 2 | 4 | 8 | 16 | 32,
          temperature: 21,
          target_temp_low: 19,
          target_temp_high: 24,
          humidity: 45,
          current_humidity: 40,
          fan_mode: 'auto',
          fan_modes: ['auto'],
          preset_mode: 'away',
          preset_modes: ['home', 'away'],
          swing_mode: 'on',
          swing_modes: ['on', 'off'],
        }),
      ),
      'climate',
    );
    assert.deepEqual(
      [full.target, full.targetLow, full.targetHigh, full.targetHumidity, full.presetMode, full.swingMode, full.fanMode],
      [21, 19, 24, 45, 'away', 'on', 'auto'],
    );
    assert.deepEqual([full.minHumidity, full.maxHumidity], [30, 99], "Home Assistant's defaults");

    const bare = one(
      capsOf('climate.t', st('heat', { temperature: 21, target_temp_low: 19, target_temp_high: 24, humidity: 45, current_humidity: 40, preset_modes: ['eco'], swing_modes: ['on'], fan_modes: ['low'] })),
      'climate',
    );
    assert.deepEqual(
      [bare.target, bare.targetLow, bare.targetHigh, bare.targetHumidity, bare.presetMode, bare.swingMode, bare.fanMode],
      [null, null, null, null, null, null, null],
    );
    assert.deepEqual([bare.presetModes, bare.swingModes, bare.fanModes], [[], [], []]);
    assert.equal(bare.currentHumidity, 40, 'a reading, not a control');
  });

  test('cover: tilt only with its bits', () => {
    const blinds = one(capsOf('cover.b', st('open', { supported_features: 255, current_position: 60, current_tilt_position: 45 })), 'cover');
    assert.deepEqual([blinds.canPosition, blinds.canStop, blinds.tilt, blinds.canTilt, blinds.canSetTilt], [true, true, 45, true, true]);
    const shutter = one(capsOf('cover.s', st('closed', { supported_features: 1 | 2 | 4 | 8, current_position: 0, current_tilt_position: 45 })), 'cover');
    assert.deepEqual([shutter.tilt, shutter.canTilt, shutter.canSetTilt], [null, false, false]);
    const tiltOnly = one(capsOf('cover.t', st('open', { supported_features: 16 | 32, current_tilt_position: 10 })), 'cover');
    assert.deepEqual([tiltOnly.tilt, tiltOnly.canTilt, tiltOnly.canSetTilt, tiltOnly.canStop], [10, true, false, false]);
  });

  test('fan: speed steps, presets, oscillation and direction only when supported', () => {
    const full = one(
      capsOf('fan.f', st('on', { supported_features: 1 | 2 | 4 | 8, percentage: 66, percentage_step: 33.33, preset_mode: 'nature', preset_modes: ['nature'], oscillating: true, direction: 'reverse' })),
      'fan',
    );
    assert.deepEqual(
      [full.percentage, full.percentageStep, full.presetMode, full.presetModes, full.oscillating, full.direction],
      [66, 33.33, 'nature', ['nature'], true, 'reverse'],
    );
    const speedOnly = one(capsOf('fan.f', st('off', { supported_features: 1, percentage: 0, oscillating: true, direction: 'forward', preset_modes: ['x'] })), 'fan');
    assert.deepEqual(
      [speedOnly.percentage, speedOnly.percentageStep, speedOnly.presetModes, speedOnly.oscillating, speedOnly.direction],
      [0, 1, [], null, null],
    );
    const swingOnly = one(capsOf('fan.f', st('on', { supported_features: 2, percentage: 50 })), 'fan');
    assert.deepEqual([swingOnly.percentage, swingOnly.oscillating], [null, false]);
    assert.deepEqual(capsOf('fan.f', st('on')).map((capability) => capability.type), ['power'], 'an on/off fan is just power');
  });

  test('media player: every feature bit, and a bare player that can do nothing', () => {
    const tv = capsOf(
      'media_player.tv',
      st('playing', {
        supported_features: 1 | 4 | 8 | 16 | 32 | 128 | 256 | 1024 | 2048 | 4096 | 16384 | 32768 | 65536 | 262144,
        volume_level: 0.3,
        is_volume_muted: true,
        media_title: 'Song',
        media_artist: 'Band',
        source: 'Spotify',
        source_list: ['Spotify', 'TV'],
        sound_mode: 'Music',
        sound_mode_list: ['Music', 'Movie'],
        shuffle: true,
        repeat: 'all',
      }),
    );
    assert.deepEqual(tv.map((capability) => capability.type), ['power', 'media']);
    const media = one(tv, 'media');
    assert.deepEqual(
      [media.volume, media.muted, media.title, media.artist, media.source, media.soundMode, media.soundModes, media.shuffle, media.repeat],
      [0.3, true, 'Song', 'Band', 'Spotify', 'Music', ['Music', 'Movie'], true, 'all'],
    );
    assert.deepEqual(
      [media.canPlay, media.canPause, media.canStop, media.canNext, media.canPrevious, media.canVolumeStep],
      [true, true, true, true, true, true],
    );

    const bare = capsOf(
      'media_player.speaker',
      st('idle', { volume_level: 0.3, is_volume_muted: false, source_list: ['A'], sound_mode_list: ['B'], shuffle: true, repeat: 'one', media_artist: 'Band' }),
    );
    assert.deepEqual(bare.map((capability) => capability.type), ['media'], 'no power without TURN_ON / TURN_OFF');
    const nothing = one(bare, 'media');
    assert.deepEqual(
      [nothing.volume, nothing.muted, nothing.sources, nothing.soundMode, nothing.soundModes, nothing.shuffle, nothing.repeat],
      [null, null, [], null, [], null, null],
    );
    assert.deepEqual(
      [nothing.canPlay, nothing.canPause, nothing.canStop, nothing.canNext, nothing.canPrevious, nothing.canVolumeStep],
      [false, false, false, false, false, false],
    );
    assert.equal(nothing.artist, 'Band', 'what is playing is a reading');

    assert.equal(one(capsOf('media_player.v', st('on', { supported_features: 4, volume_level: 0.5 })), 'media').canVolumeStep, true, 'VOLUME_SET steps too');
    assert.equal(one(capsOf('media_player.v', st('on', { supported_features: 1024 })), 'media').canVolumeStep, true);
    const off = one(capsOf('media_player.v', st('off', { supported_features: 32768 | 262144 })), 'media');
    assert.deepEqual([off.shuffle, off.repeat], [false, 'off'], 'an off player reports neither but can set both');
  });

  test('light effects are an option, only with the EFFECT bit', () => {
    const effect = one(capsOf('light.strip', st('on', { supported_features: 4, supported_color_modes: ['hs'], effect: 'Rainbow', effect_list: ['Rainbow', 'Fire'] })), 'option');
    assert.deepEqual(effect, { entityId: 'light.strip', label: 'Effect', type: 'option', role: 'effect', value: 'Rainbow', options: ['Rainbow', 'Fire'] });
    assert.ok(!capsOf('light.strip', st('on', { supported_color_modes: ['hs'], effect_list: ['Rainbow'] })).some((capability) => capability.type === 'option'));
  });

  test('lock: open only with the OPEN bit', () => {
    assert.equal(one(capsOf('lock.door', st('locked', { supported_features: 1 })), 'lock').canOpen, true);
    assert.equal(one(capsOf('lock.door', st('locked')), 'lock').canOpen, false);
  });

  test('vacuum: battery, suction and each action from its bits', () => {
    const robot = one(
      capsOf('vacuum.r', st('cleaning', { supported_features: 4 | 8 | 16 | 32 | 64 | 512 | 1024 | 8192, battery_level: 80, fan_speed: 'max', fan_speed_list: ['quiet', 'max'] })),
      'vacuum',
    );
    assert.deepEqual(
      [robot.state, robot.battery, robot.fanSpeed, robot.fanSpeeds, robot.canPause, robot.canStop, robot.canReturn, robot.canLocate, robot.canSpot],
      ['cleaning', 80, 'max', ['quiet', 'max'], true, true, true, true, true],
    );
    const basic = one(capsOf('vacuum.r', st('docked', { supported_features: 8192, battery_level: 80, fan_speed: 'max', fan_speed_list: ['max'] })), 'vacuum');
    assert.deepEqual(
      [basic.battery, basic.fanSpeed, basic.fanSpeeds, basic.canPause, basic.canStop, basic.canReturn, basic.canLocate, basic.canSpot],
      [null, null, [], false, false, false, false, false],
    );
  });

  test('humidifier: power, target and modes', () => {
    const caps = capsOf('humidifier.h', st('on', { supported_features: 1, humidity: 50, current_humidity: 42, min_humidity: 30, max_humidity: 80, mode: 'auto', available_modes: ['auto', 'sleep'] }));
    assert.deepEqual(caps.map((capability) => capability.type), ['power', 'humidifier']);
    const humidifier = one(caps, 'humidifier');
    assert.deepEqual(
      [humidifier.current, humidifier.target, humidifier.min, humidifier.max, humidifier.mode, humidifier.modes],
      [42, 50, 30, 80, 'auto', ['auto', 'sleep']],
    );
    const plain = one(capsOf('humidifier.h', st('off', { humidity: 50, mode: 'auto', available_modes: ['auto'] })), 'humidifier');
    assert.deepEqual([plain.min, plain.max, plain.mode, plain.modes], [0, 100, null, []]);
  });

  test('water heater: power only with ON_OFF; target, modes and away from their bits', () => {
    const caps = capsOf(
      'water_heater.w',
      st('eco', { supported_features: 1 | 2 | 4 | 8, temperature: 55, current_temperature: 50, min_temp: 40, max_temp: 65, operation_mode: 'eco', operation_list: ['eco', 'electric', 'off'], away_mode: 'on' }),
    );
    assert.deepEqual(caps.map((capability) => capability.type), ['power', 'water_heater']);
    assert.equal(one(caps, 'power').value, 'on');
    const heater = one(caps, 'water_heater');
    assert.deepEqual([heater.current, heater.target, heater.min, heater.max, heater.mode, heater.modes, heater.away], [50, 55, 40, 65, 'eco', ['eco', 'electric', 'off'], true]);
    const bare = capsOf('water_heater.w', st('eco', { temperature: 55, current_temperature: 50, operation_list: ['eco'], away_mode: 'off' }));
    assert.deepEqual(bare.map((capability) => capability.type), ['water_heater']);
    const nothing = one(bare, 'water_heater');
    assert.deepEqual([nothing.target, nothing.mode, nothing.modes, nothing.away, nothing.current], [null, null, [], null, 50]);
  });

  test('valve: position and stop from their bits', () => {
    const valve = one(capsOf('valve.water', st('open', { supported_features: 1 | 2 | 4 | 8, current_position: 70 })), 'valve');
    assert.deepEqual([valve.state, valve.position, valve.canPosition, valve.canStop], ['open', 70, true, true]);
    const simple = one(capsOf('valve.gas', st('closed', { supported_features: 1 | 2 })), 'valve');
    assert.deepEqual([simple.position, simple.canPosition, simple.canStop], [null, false, false]);
  });

  test('alarm: arm modes from the bits, a code when the panel has a format', () => {
    const panel = one(capsOf('alarm_control_panel.a', st('disarmed', { supported_features: 1 | 2 | 4 | 16 | 32, code_format: 'number' })), 'alarm');
    assert.deepEqual(panel.modes, ['home', 'away', 'night', 'vacation', 'custom_bypass']);
    assert.equal(panel.codeRequired, true);
    const simple = one(capsOf('alarm_control_panel.a', st('armed_away', { supported_features: 2, code_format: null })), 'alarm');
    assert.deepEqual([simple.state, simple.modes, simple.codeRequired], ['armed_away', ['away'], false]);
    assert.deepEqual(one(capsOf('alarm_control_panel.a', st('disarmed')), 'alarm').modes, []);
  });

  test('lawn mower: pause and dock from their bits', () => {
    const mower = one(capsOf('lawn_mower.m', st('mowing', { supported_features: 1 | 2 | 4 })), 'mower');
    assert.deepEqual([mower.state, mower.canPause, mower.canDock], ['mowing', true, true]);
    const basic = one(capsOf('lawn_mower.m', st('docked', { supported_features: 1 })), 'mower');
    assert.deepEqual([basic.canPause, basic.canDock], [false, false]);
  });

  test('remote: power, plus activities with the ACTIVITY bit; siren: power', () => {
    const hub = capsOf('remote.hub', st('on', { supported_features: 4, current_activity: 'Watch TV', activity_list: ['Watch TV', 'Music'] }));
    assert.deepEqual(hub.map((capability) => capability.type), ['power', 'option']);
    assert.deepEqual(one(hub, 'option'), { entityId: 'remote.hub', label: 'Activity', type: 'option', role: 'activity', value: 'Watch TV', options: ['Watch TV', 'Music'] });
    assert.deepEqual(capsOf('remote.ir', st('on', { activity_list: ['x'] })).map((capability) => capability.type), ['power']);
    assert.deepEqual(capsOf('siren.s', st('off')), [{ entityId: 'siren.s', label: 'Thing', type: 'power', value: 'off' }]);
  });

  test('select and input_select are options; an unknown state is no value', () => {
    assert.deepEqual(one(capsOf('input_select.scene', st('Relax', { options: ['Relax', 'Party'] })), 'option'), {
      entityId: 'input_select.scene',
      label: 'Thing',
      type: 'option',
      role: 'setting',
      value: 'Relax',
      options: ['Relax', 'Party'],
    });
    assert.equal(one(capsOf('select.mode', st('unknown', { options: ['a'] })), 'option').value, null);
  });

  test('number and input_number read their range; unavailable is no value', () => {
    assert.deepEqual(one(capsOf('input_number.target', st('21.5', { min: 15, max: 30, step: 0.5, unit_of_measurement: '°C' })), 'number'), {
      entityId: 'input_number.target',
      label: 'Thing',
      type: 'number',
      value: 21.5,
      min: 15,
      max: 30,
      step: 0.5,
      unit: '°C',
    });
    const unknown = one(capsOf('number.n', st('unavailable')), 'number');
    assert.deepEqual([unknown.value, unknown.min, unknown.max, unknown.step, unknown.unit], [null, 0, 100, 1, null]);
  });

  test('button and input_button are pressed', () => {
    assert.deepEqual(capsOf('input_button.doorbell', st('unknown')), [{ entityId: 'input_button.doorbell', label: 'Thing', type: 'press' }]);
    assert.deepEqual(capsOf('button.reboot', st('unknown')).map((capability) => capability.type), ['press']);
  });
});

describe('command allowlist', () => {
  const { registries, states } = fixture();
  const devices = toDevices(registries, states);
  const resolve = (id: string, request: CommandRequest) => resolveCommand(byId(devices, id), request).call;
  const on = (device: Device, request: CommandRequest) => resolveCommand(device, request).call;
  const call = (device: Device, request: CommandRequest) => {
    const { service, data } = on(device, request);
    return { service, data };
  };

  test('maps capabilities to one service on the right entity', () => {
    assert.deepEqual(resolve('dev-light', { capability: 'power', action: 'on' }), {
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.ceiling',
      data: {},
    });
    assert.deepEqual(resolve('dev-ac', { capability: 'climate', action: 'set_mode', value: 'heat' }).data, { hvac_mode: 'heat' });
    assert.deepEqual(resolve('dev-lock', { capability: 'lock', action: 'unlock' }).service, 'unlock');
  });

  test('clamps values to what the device reports', () => {
    assert.deepEqual(resolve('dev-light', { capability: 'brightness', action: 'set', value: 150 }).data, { brightness_pct: 100 });
    assert.equal(resolve('dev-light', { capability: 'brightness', action: 'set', value: 0 }).service, 'turn_off');
    assert.deepEqual(resolve('dev-light', { capability: 'color_temp', action: 'set', value: 1000 }).data, { color_temp_kelvin: 2700 });
    assert.deepEqual(resolve('dev-ac', { capability: 'climate', action: 'set_temperature', value: 40 }).data, { temperature: 30 });
  });

  test('refuses anything outside the allowlist', () => {
    assert.equal(code(() => resolve('dev-light', { capability: 'power', action: 'explode' })), 'bad_request');
    assert.equal(code(() => resolve('dev-light', { capability: '__proto__' as never, action: 'toString' })), 'bad_request');
    assert.equal(code(() => resolve('dev-light', { capability: 'power', action: 'constructor' })), 'bad_request');
    assert.equal(code(() => resolve('dev-ac', { capability: 'climate', action: 'set_mode', value: 'turbo' })), 'bad_request');
    assert.equal(code(() => resolve('dev-light', { capability: 'brightness', action: 'set', value: '50' })), 'bad_request');
    assert.equal(code(() => resolve('dev-tv', { capability: 'media', action: 'play_media', value: 'http://x' })), 'bad_request');
  });

  test('refuses capabilities the device does not have, and entities of other devices', () => {
    assert.equal(code(() => resolve('dev-plug', { capability: 'brightness', action: 'set', value: 50 })), 'not_available');
    assert.equal(code(() => resolve('dev-plug', { capability: 'power', action: 'on', entityId: 'light.ceiling' })), 'not_available');
    assert.equal(code(() => resolve('dev-plug', { capability: 'power', action: 'on', entityId: 'sensor.plug_power' })), 'not_available');
  });

  test('settings take commands too; without an entityId the plug itself is switched', () => {
    assert.equal(resolve('dev-plug', { capability: 'power', action: 'on' }).entityId, 'switch.plug');
    assert.equal(resolve('dev-plug', { capability: 'power', action: 'on', entityId: 'switch.plug_child_lock' }).entityId, 'switch.plug_child_lock');
    assert.deepEqual(resolve('dev-plug', { capability: 'option', action: 'select', value: 'on' }), {
      domain: 'select',
      service: 'select_option',
      entityId: 'select.plug_power_on',
      data: { option: 'on' },
    });
  });

  test('climate: range, presets, swing and humidity', () => {
    const range = deviceWith(
      one(capsOf('climate.t', st('heat_cool', { supported_features: 2 | 4, target_temp_low: 19, target_temp_high: 24, min_temp: 10, max_temp: 30, humidity: 40, min_humidity: 35, max_humidity: 60 })), 'climate'),
    );
    assert.deepEqual(call(range, { capability: 'climate', action: 'set_temperature_range', value: { low: 5, high: 23 } }), {
      service: 'set_temperature',
      data: { target_temp_low: 10, target_temp_high: 23 },
    });
    assert.equal(code(() => on(range, { capability: 'climate', action: 'set_temperature_range', value: { low: 25, high: 20 } })), 'bad_request');
    assert.equal(code(() => on(range, { capability: 'climate', action: 'set_temperature_range', value: 22 })), 'bad_request');
    assert.deepEqual(call(range, { capability: 'climate', action: 'set_humidity', value: 72.4 }), { service: 'set_humidity', data: { humidity: 60 } });
    assert.deepEqual(call(range, { capability: 'climate', action: 'set_humidity', value: 44.6 }), { service: 'set_humidity', data: { humidity: 45 } });
    assert.equal(code(() => on(range, { capability: 'climate', action: 'set_temperature', value: 21 })), 'not_available');

    assert.deepEqual(resolve('dev-ac', { capability: 'climate', action: 'set_preset', value: 'eco' }), {
      domain: 'climate',
      service: 'set_preset_mode',
      entityId: 'climate.ac',
      data: { preset_mode: 'eco' },
    });
    assert.deepEqual(resolve('dev-ac', { capability: 'climate', action: 'set_swing_mode', value: 'both' }).data, { swing_mode: 'both' });
    assert.equal(code(() => resolve('dev-ac', { capability: 'climate', action: 'set_preset', value: 'turbo' })), 'bad_request');
    assert.equal(code(() => resolve('dev-ac', { capability: 'climate', action: 'set_temperature_range', value: { low: 20, high: 24 } })), 'not_available');

    const bare = deviceWith(one(capsOf('climate.t', st('heat', { temperature: 20 })), 'climate'));
    for (const [action, value] of [
      ['set_temperature', 20],
      ['set_preset', 'eco'],
      ['set_swing_mode', 'on'],
      ['set_humidity', 50],
      ['set_fan_mode', 'low'],
      ['set_mode', 'heat'],
    ] as const) {
      assert.equal(code(() => on(bare, { capability: 'climate', action, value })), 'not_available', action);
    }
  });

  test('cover: tilt actions, clamped, and refused without tilt', () => {
    assert.equal(resolve('dev-blinds', { capability: 'cover', action: 'open_tilt' }).service, 'open_cover_tilt');
    assert.equal(resolve('dev-blinds', { capability: 'cover', action: 'close_tilt' }).service, 'close_cover_tilt');
    assert.equal(resolve('dev-blinds', { capability: 'cover', action: 'stop_tilt' }).service, 'stop_cover_tilt');
    assert.deepEqual(resolve('dev-blinds', { capability: 'cover', action: 'set_tilt', value: 150 }), {
      domain: 'cover',
      service: 'set_cover_tilt_position',
      entityId: 'cover.blinds',
      data: { tilt_position: 100 },
    });
    assert.deepEqual(resolve('dev-blinds', { capability: 'cover', action: 'set_tilt', value: 33.4 }).data, { tilt_position: 33 });
    const shutter = deviceWith(one(capsOf('cover.s', st('open', { supported_features: 1 | 2 })), 'cover'));
    for (const action of ['open_tilt', 'close_tilt', 'stop_tilt', 'set_tilt', 'stop', 'set_position']) {
      assert.equal(code(() => on(shutter, { capability: 'cover', action, value: 50 })), 'not_available', action);
    }
  });

  test('lock: open (unlatch) only when the lock can', () => {
    assert.deepEqual(resolve('dev-lock', { capability: 'lock', action: 'open' }), { domain: 'lock', service: 'open', entityId: 'lock.front', data: {} });
    const plain = deviceWith(one(capsOf('lock.door', st('locked')), 'lock'));
    assert.equal(code(() => on(plain, { capability: 'lock', action: 'open' })), 'not_available');
  });

  test('fan: oscillation and direction, checked', () => {
    const fan = deviceWith(one(capsOf('fan.f', st('on', { supported_features: 1 | 2 | 4 | 8, percentage: 50, preset_modes: ['nature'] })), 'fan'));
    assert.deepEqual(call(fan, { capability: 'fan', action: 'set_oscillating', value: true }), { service: 'oscillate', data: { oscillating: true } });
    assert.deepEqual(call(fan, { capability: 'fan', action: 'set_direction', value: 'reverse' }), { service: 'set_direction', data: { direction: 'reverse' } });
    assert.deepEqual(call(fan, { capability: 'fan', action: 'set_preset', value: 'nature' }), { service: 'set_preset_mode', data: { preset_mode: 'nature' } });
    assert.deepEqual(call(fan, { capability: 'fan', action: 'set_percentage', value: 120 }), { service: 'set_percentage', data: { percentage: 100 } });
    assert.equal(code(() => on(fan, { capability: 'fan', action: 'set_direction', value: 'sideways' })), 'bad_request');
    assert.equal(code(() => on(fan, { capability: 'fan', action: 'set_oscillating', value: 'yes' })), 'bad_request');
    const swing = deviceWith(one(capsOf('fan.f', st('on', { supported_features: 2, percentage: 50 })), 'fan'));
    for (const [action, value] of [
      ['set_percentage', 50],
      ['set_direction', 'forward'],
      ['set_preset', 'nature'],
    ] as const) {
      assert.equal(code(() => on(swing, { capability: 'fan', action, value })), 'not_available', action);
    }
  });

  test('media: every action to its one service', () => {
    const tv = (action: string, value?: unknown) => call(byId(devices, 'dev-tv'), { capability: 'media', action, value });
    assert.deepEqual(
      [
        tv('play'),
        tv('pause'),
        tv('play_pause'),
        tv('stop'),
        tv('next'),
        tv('previous'),
        tv('volume_up'),
        tv('volume_down'),
        tv('set_volume', 2),
        tv('mute', true),
        tv('select_source', 'YouTube'),
        tv('select_sound_mode', 'Music'),
        tv('set_shuffle', true),
        tv('set_repeat', 'one'),
      ],
      [
        { service: 'media_play', data: {} },
        { service: 'media_pause', data: {} },
        { service: 'media_play_pause', data: {} },
        { service: 'media_stop', data: {} },
        { service: 'media_next_track', data: {} },
        { service: 'media_previous_track', data: {} },
        { service: 'volume_up', data: {} },
        { service: 'volume_down', data: {} },
        { service: 'volume_set', data: { volume_level: 1 } },
        { service: 'volume_mute', data: { is_volume_muted: true } },
        { service: 'select_source', data: { source: 'YouTube' } },
        { service: 'select_sound_mode', data: { sound_mode: 'Music' } },
        { service: 'shuffle_set', data: { shuffle: true } },
        { service: 'repeat_set', data: { repeat: 'one' } },
      ],
    );
    assert.equal(code(() => tv('set_repeat', 'forever')), 'bad_request');
    assert.equal(code(() => tv('select_sound_mode', 'Disco')), 'bad_request');
    assert.equal(code(() => tv('set_shuffle', 1)), 'bad_request');
  });

  test('media: a player refuses what it does not report', () => {
    const speaker = deviceWith(one(capsOf('media_player.s', st('idle', { volume_level: 0.5, source_list: ['A'], sound_mode_list: ['B'], shuffle: false, repeat: 'off' })), 'media'));
    for (const [action, value] of [
      ['play', undefined],
      ['pause', undefined],
      ['play_pause', undefined],
      ['stop', undefined],
      ['next', undefined],
      ['previous', undefined],
      ['volume_up', undefined],
      ['volume_down', undefined],
      ['set_volume', 0.5],
      ['mute', true],
      ['select_source', 'A'],
      ['select_sound_mode', 'B'],
      ['set_shuffle', true],
      ['set_repeat', 'all'],
    ] as const) {
      assert.equal(code(() => on(speaker, { capability: 'media', action, value })), 'not_available', action);
    }
    const playOnly = deviceWith(one(capsOf('media_player.p', st('idle', { supported_features: 16384 })), 'media'));
    assert.equal(code(() => on(playOnly, { capability: 'media', action: 'play_pause' })), 'not_available', 'play_pause needs both');
  });

  test('option: a select picks its option, a light its effect, a remote its activity', () => {
    const select = deviceWith(...capsOf('input_select.scene', st('Relax', { options: ['Relax', 'Party'] })));
    assert.deepEqual(on(select, { capability: 'option', action: 'select', value: 'Party' }), {
      domain: 'input_select',
      service: 'select_option',
      entityId: 'input_select.scene',
      data: { option: 'Party' },
    });
    const strip = deviceWith(...capsOf('light.strip', st('on', { supported_features: 4, supported_color_modes: ['onoff'], effect_list: ['Rainbow'] })));
    assert.deepEqual(on(strip, { capability: 'option', action: 'select', value: 'Rainbow' }), {
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.strip',
      data: { effect: 'Rainbow' },
    });
    const hub = deviceWith(...capsOf('remote.hub', st('on', { supported_features: 4, activity_list: ['Watch TV'] })));
    assert.deepEqual(on(hub, { capability: 'option', action: 'select', value: 'Watch TV' }), {
      domain: 'remote',
      service: 'turn_on',
      entityId: 'remote.hub',
      data: { activity: 'Watch TV' },
    });
    assert.equal(code(() => on(hub, { capability: 'option', action: 'select', value: 'Reboot' })), 'bad_request');
    const empty = deviceWith(...capsOf('select.empty', st('unknown', { options: [] })));
    assert.equal(code(() => on(empty, { capability: 'option', action: 'select', value: 'x' })), 'not_available');
  });

  test('number: clamped and rounded to the step', () => {
    const transition = (value: unknown) => resolve('dev-light', { capability: 'number', action: 'set', value });
    assert.deepEqual(transition(2.7), { domain: 'number', service: 'set_value', entityId: 'number.ceiling_transition', data: { value: 2.5 } });
    assert.deepEqual(transition(2.76).data, { value: 3 });
    assert.deepEqual(transition(99).data, { value: 10 });
    assert.deepEqual(transition(-4).data, { value: 0 });
    assert.equal(code(() => transition('5')), 'bad_request');
    const fine = deviceWith(...capsOf('input_number.level', st('0', { min: 0, max: 1, step: 0.1 })));
    assert.deepEqual(on(fine, { capability: 'number', action: 'set', value: 0.3 }), {
      domain: 'input_number',
      service: 'set_value',
      entityId: 'input_number.level',
      data: { value: 0.3 },
    });
    const odd = deviceWith(...capsOf('number.odd', st('1', { min: 1, max: 10, step: 2 })));
    assert.deepEqual(on(odd, { capability: 'number', action: 'set', value: 10 }).data, { value: 9 }, 'never past max');
  });

  test('vacuum: each action, and a basic one that only starts', () => {
    const robot = (action: string, value?: unknown) => call(byId(devices, 'dev-vacuum'), { capability: 'vacuum', action, value });
    assert.deepEqual(
      ['start', 'pause', 'stop', 'return_to_base', 'locate', 'clean_spot'].map((action) => robot(action).service),
      ['start', 'pause', 'stop', 'return_to_base', 'locate', 'clean_spot'],
    );
    assert.deepEqual(robot('set_fan_speed', 'turbo'), { service: 'set_fan_speed', data: { fan_speed: 'turbo' } });
    assert.equal(code(() => robot('set_fan_speed', 'hurricane')), 'bad_request');
    const basic = deviceWith(...capsOf('vacuum.b', st('docked', { supported_features: 8192 })));
    assert.equal(on(basic, { capability: 'vacuum', action: 'start' }).service, 'start');
    for (const action of ['pause', 'stop', 'return_to_base', 'locate', 'clean_spot', 'set_fan_speed']) {
      assert.equal(code(() => on(basic, { capability: 'vacuum', action, value: 'max' })), 'not_available', action);
    }
  });

  test('humidifier: humidity clamped and whole, modes from its list', () => {
    const humidifier = deviceWith(...capsOf('humidifier.h', st('on', { supported_features: 1, min_humidity: 30, max_humidity: 80, available_modes: ['auto', 'sleep'] })));
    assert.deepEqual(on(humidifier, { capability: 'humidifier', action: 'set_humidity', value: 85.4 }), {
      domain: 'humidifier',
      service: 'set_humidity',
      entityId: 'humidifier.h',
      data: { humidity: 80 },
    });
    assert.deepEqual(call(humidifier, { capability: 'humidifier', action: 'set_humidity', value: 44.6 }).data, { humidity: 45 });
    assert.deepEqual(call(humidifier, { capability: 'humidifier', action: 'set_mode', value: 'sleep' }), { service: 'set_mode', data: { mode: 'sleep' } });
    assert.equal(on(humidifier, { capability: 'power', action: 'toggle' }).service, 'toggle');
    const plain = deviceWith(...capsOf('humidifier.h', st('on', { available_modes: ['auto'] })));
    assert.equal(code(() => on(plain, { capability: 'humidifier', action: 'set_mode', value: 'auto' })), 'not_available');
  });

  test('water heater: temperature, operation mode, away, and power without a toggle service', () => {
    const heater = deviceWith(
      ...capsOf('water_heater.w', st('eco', { supported_features: 1 | 2 | 4 | 8, temperature: 50, min_temp: 40, max_temp: 60, operation_list: ['eco', 'performance'], away_mode: 'off' })),
    );
    assert.deepEqual(call(heater, { capability: 'water_heater', action: 'set_temperature', value: 75 }), { service: 'set_temperature', data: { temperature: 60 } });
    assert.deepEqual(call(heater, { capability: 'water_heater', action: 'set_mode', value: 'performance' }), {
      service: 'set_operation_mode',
      data: { operation_mode: 'performance' },
    });
    assert.deepEqual(call(heater, { capability: 'water_heater', action: 'set_away', value: true }), { service: 'set_away_mode', data: { away_mode: true } });
    assert.deepEqual(on(heater, { capability: 'power', action: 'toggle' }), { domain: 'water_heater', service: 'turn_off', entityId: 'water_heater.w', data: {} });
    const bare = deviceWith(...capsOf('water_heater.w', st('eco', { temperature: 50, operation_list: ['eco'], away_mode: 'off' })));
    for (const [action, value] of [
      ['set_temperature', 50],
      ['set_mode', 'eco'],
      ['set_away', true],
    ] as const) {
      assert.equal(code(() => on(bare, { capability: 'water_heater', action, value })), 'not_available', action);
    }
    assert.equal(code(() => on(bare, { capability: 'power', action: 'on' })), 'not_available', 'no ON_OFF, no power');
  });

  test('valve: open, close, stop and position', () => {
    const valve = deviceWith(...capsOf('valve.water', st('open', { supported_features: 1 | 2 | 4 | 8, current_position: 50 })));
    assert.deepEqual(
      ['open', 'close', 'stop'].map((action) => on(valve, { capability: 'valve', action }).service),
      ['open_valve', 'close_valve', 'stop_valve'],
    );
    assert.deepEqual(call(valve, { capability: 'valve', action: 'set_position', value: -5 }), { service: 'set_valve_position', data: { position: 0 } });
    const simple = deviceWith(...capsOf('valve.gas', st('closed', { supported_features: 1 | 2 })));
    assert.equal(on(simple, { capability: 'valve', action: 'open' }).service, 'open_valve');
    assert.equal(code(() => on(simple, { capability: 'valve', action: 'stop' })), 'not_available');
    assert.equal(code(() => on(simple, { capability: 'valve', action: 'set_position', value: 50 })), 'not_available');
  });

  test('alarm: arm one of its modes, with or without a code; disarm with the code it needs', () => {
    const alarm = (action: string, value?: unknown) => call(byId(devices, 'dev-alarm'), { capability: 'alarm', action, value });
    assert.deepEqual(alarm('arm', { mode: 'away' }), { service: 'alarm_arm_away', data: {} });
    assert.deepEqual(alarm('arm', { mode: 'vacation', code: '1234' }), { service: 'alarm_arm_vacation', data: { code: '1234' } });
    assert.deepEqual(alarm('arm', 'night'), { service: 'alarm_arm_night', data: {} });
    assert.deepEqual(alarm('disarm', { code: '1234' }), { service: 'alarm_disarm', data: { code: '1234' } });
    assert.equal(code(() => alarm('arm', { mode: 'custom_bypass' })), 'bad_request', 'not one of its modes');
    assert.equal(code(() => alarm('arm', { mode: 'away', code: 1234 })), 'bad_request');
    assert.equal(code(() => alarm('arm', { mode: 'away', code: 'x'.repeat(33) })), 'bad_request');
    assert.equal(code(() => alarm('arm', ['away'])), 'bad_request');
    assert.equal(code(() => alarm('disarm')), 'bad_request', 'the panel needs its code');
    assert.equal(code(() => alarm('trigger')), 'bad_request');

    const open = deviceWith(...capsOf('alarm_control_panel.a', st('armed_home', { supported_features: 1 })));
    assert.deepEqual(call(open, { capability: 'alarm', action: 'disarm' }), { service: 'alarm_disarm', data: {} });
    const none = deviceWith(...capsOf('alarm_control_panel.a', st('disarmed')));
    assert.equal(code(() => on(none, { capability: 'alarm', action: 'arm', value: { mode: 'home' } })), 'not_available');
  });

  test('mower: start, pause and dock', () => {
    const mower = deviceWith(...capsOf('lawn_mower.m', st('docked', { supported_features: 1 | 2 | 4 })));
    assert.deepEqual(
      ['start', 'pause', 'dock'].map((action) => on(mower, { capability: 'mower', action })),
      ['start_mowing', 'pause', 'dock'].map((service) => ({ domain: 'lawn_mower', service, entityId: 'lawn_mower.m', data: {} })),
    );
    const basic = deviceWith(...capsOf('lawn_mower.m', st('docked', { supported_features: 1 })));
    assert.equal(code(() => on(basic, { capability: 'mower', action: 'pause' })), 'not_available');
    assert.equal(code(() => on(basic, { capability: 'mower', action: 'dock' })), 'not_available');
  });

  test('press: buttons and input buttons', () => {
    const doorbell = deviceWith(...capsOf('input_button.doorbell', st('unknown')));
    assert.deepEqual(on(doorbell, { capability: 'press', action: 'press' }), { domain: 'input_button', service: 'press', entityId: 'input_button.doorbell', data: {} });
  });

  test('door and alarm actions are audited; the assistant may not open, unlock or disarm', () => {
    const action = (id: string, request: CommandRequest) => {
      const { domain, service } = resolve(id, request);
      return `${domain}.${service}`;
    };
    const unlock = action('dev-lock', { capability: 'lock', action: 'unlock' });
    const open = action('dev-lock', { capability: 'lock', action: 'open' });
    const disarm = action('dev-alarm', { capability: 'alarm', action: 'disarm', value: { code: '1' } });
    const arms = (['home', 'away', 'night', 'vacation'] as const).map((mode) => action('dev-alarm', { capability: 'alarm', action: 'arm', value: { mode } }));
    for (const refused of [unlock, open, disarm]) {
      assert.ok(ASSISTANT_REFUSED.has(refused), refused);
      assert.ok(AUDITED.has(refused), refused);
    }
    for (const arm of [...arms, 'alarm_control_panel.alarm_arm_custom_bypass']) {
      assert.ok(AUDITED.has(arm), arm);
      assert.ok(!ASSISTANT_REFUSED.has(arm), arm);
    }
    assert.ok(!ASSISTANT_REFUSED.has(action('dev-lock', { capability: 'lock', action: 'lock' })));
  });
});

describe('gateway mapping', () => {
  const tv = (commands: string[], state = 'playing'): GatewayDevice => ({
    id: 'tv',
    name: 'TV',
    brand: 'lg',
    adapter_id: 'lg_webos',
    category: 'tv',
    capabilities: [{ key: 'media', type: 'media', label: 'TV', state, volume: 20, muted: false, sources: [] }],
    commands,
  });

  test('media flags come from the commands the gateway accepts', () => {
    const media = one(toDevice(tv(['set_volume', 'volume_up', 'volume_down', 'media_play'])).capabilities, 'media');
    assert.deepEqual(
      [media.canPlay, media.canPause, media.canStop, media.canNext, media.canPrevious, media.canVolumeStep],
      [true, false, false, false, false, true],
    );
    assert.deepEqual([media.artist, media.soundModes, media.shuffle, media.repeat], [null, [], null, null]);
  });

  test('volume steps and play/pause become the gateway commands, only when the device lists them', () => {
    const full = tv(['volume_up', 'volume_down', 'media_play', 'media_pause']);
    assert.deepEqual(toGatewayCommand(full, { capability: 'media', action: 'volume_up' }), { command: 'volume_up', params: {} });
    assert.deepEqual(toGatewayCommand(full, { capability: 'media', action: 'volume_down' }), { command: 'volume_down', params: {} });
    assert.deepEqual(toGatewayCommand(full, { capability: 'media', action: 'play_pause' }), { command: 'media_pause', params: {} });
    assert.deepEqual(toGatewayCommand(tv(['media_play'], 'paused'), { capability: 'media', action: 'play_pause' }), { command: 'media_play', params: {} });
    assert.equal(code(() => toGatewayCommand(tv(['media_play']), { capability: 'media', action: 'volume_up' })), 'not_available');
    assert.equal(code(() => toGatewayCommand(full, { capability: 'media', action: 'set_shuffle', value: true })), 'not_available');
  });
});
