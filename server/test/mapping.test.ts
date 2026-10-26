import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCommand } from '../src/ha/commands.ts';
import { toDevices, toRooms } from '../src/ha/mapping.ts';
import type { CommandRequest, Device, HaArea, HaDevice, HaEntity, HaState, Registries } from '../src/ha/types.ts';
import { demoHome } from './fakeHa.ts';

/** Home Assistant registries and states → Park-Lane devices, and the command allowlist. Pure, no network. */

function fixture(): { registries: Registries; states: Map<string, HaState> } {
  const home = demoHome();
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

describe('mapping', () => {
  const { registries, states } = fixture();
  const devices = toDevices(registries, states);

  test('shows real devices and lone helpers, and leaves out services, hidden and empty ones', () => {
    assert.deepEqual(devices.map((device) => device.id).sort(), [
      'dev-ac',
      'dev-light',
      'dev-lock',
      'dev-plug',
      'dev-sensor',
      'e.input_boolean.guest_mode',
    ]);
  });

  test('a colour-temperature light gets power, brightness and colour temperature', () => {
    const light = byId(devices, 'dev-light');
    assert.equal(light.kind, 'light');
    assert.equal(light.room, 'Living Room');
    assert.equal(light.integration, 'tuya');
    assert.equal(light.accountId, 'entry-tuya');
    assert.deepEqual(
      light.capabilities.map((capability) => capability.type),
      ['power', 'brightness', 'color_temp'],
    );
    const temp = light.capabilities.find((capability) => capability.type === 'color_temp');
    assert.equal(temp?.type === 'color_temp' && temp.min, 2700);
  });

  test('an outlet switch is a plug; its config entity is hidden and its sensor kept', () => {
    const plug = byId(devices, 'dev-plug');
    assert.equal(plug.kind, 'plug');
    assert.deepEqual(plug.capabilities.map((capability) => capability.entityId), ['switch.plug']);
    assert.deepEqual(plug.sensors, [{ entityId: 'sensor.plug_power', label: 'Power', value: '0', unit: 'W', deviceClass: 'power' }]);
  });

  test('climate reads its range, modes and fan modes', () => {
    const ac = byId(devices, 'dev-ac').capabilities[0];
    assert.equal(ac.type, 'climate');
    if (ac.type === 'climate') {
      assert.equal(ac.target, 24);
      assert.deepEqual([ac.min, ac.max, ac.step], [16, 30, 1]);
      assert.deepEqual(ac.modes, ['off', 'cool', 'heat']);
      assert.deepEqual(ac.fanModes, ['low', 'high']);
    }
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
    assert.equal(plug.online, false);
  });

  test('rooms count their devices', () => {
    assert.deepEqual(
      toRooms(registries, devices).map((room) => [room.name, room.deviceCount]),
      [
        ['Bedroom', 2],
        ['Living Room', 3],
      ],
    );
  });
});

describe('command allowlist', () => {
  const { registries, states } = fixture();
  const devices = toDevices(registries, states);
  const resolve = (id: string, request: CommandRequest) => resolveCommand(byId(devices, id), request).call;
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as { code: string }).code;
    }
    return 'no error';
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
  });

  test('refuses capabilities the device does not have, and entities of other devices', () => {
    assert.equal(code(() => resolve('dev-plug', { capability: 'brightness', action: 'set', value: 50 })), 'not_available');
    assert.equal(code(() => resolve('dev-plug', { capability: 'power', action: 'on', entityId: 'light.ceiling' })), 'not_available');
    assert.equal(code(() => resolve('dev-plug', { capability: 'power', action: 'on', entityId: 'switch.plug_child_lock' })), 'not_available');
  });
});
