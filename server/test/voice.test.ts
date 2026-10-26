import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ems-voice-'));

const { normalize, resolveDevice } = await import('../src/ems/voice.ts');
type Device = Parameters<typeof resolveDevice>[0][number];

function device(name: string, room: string | null, extra: Partial<Device> = {}): Device {
  return {
    id: `${name}-${room}`,
    name,
    room,
    type: 'switch',
    protocol: 'virtual',
    simulated: true,
    online: true,
    power: 'off',
    pendingPower: null,
    alexaEnabled: true,
    isDefault: false,
    lastSeen: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

test('folds Arabic spelling variants and diacritics', () => {
  assert.equal(normalize('أُنوار  الغُرفةِ'), normalize('انوار الغرفه'));
  assert.equal(normalize('مكيّف'), 'مكيف');
  assert.equal(normalize('Bedroom-Light!'), 'bedroom light');
});

test('matches a name with or without the room, and drops the definite article', () => {
  const devices = [device('مكيف', 'الصالة'), device('نور', 'غرفة النوم'), device('Lamp', 'Office')];
  const ac = resolveDevice(devices, 'المكيف');
  assert.ok('device' in ac && ac.device.name === 'مكيف');
  const light = resolveDevice(devices, 'نور غرفة النوم');
  assert.ok('device' in light && light.device.name === 'نور');
  const lamp = resolveDevice(devices, 'the office lamp');
  assert.ok('device' in lamp && lamp.device.name === 'Lamp');
});

test('asks which device when several match, or when none is named and there is no default', () => {
  const devices = [device('Light', 'Bedroom'), device('Light', 'Kitchen')];
  const ambiguous = resolveDevice(devices, 'light');
  assert.equal('outcome' in ambiguous && ambiguous.outcome, 'ambiguous');
  const unnamed = resolveDevice(devices);
  assert.equal('outcome' in unnamed && unnamed.outcome, 'need_device');
  const withDefault = resolveDevice([device('Light', 'Bedroom'), device('Light', 'Kitchen', { isDefault: true })]);
  assert.ok('device' in withDefault && withDefault.device.room === 'Kitchen');
});

test('a single device needs no name, and an empty home says so', () => {
  const single = resolveDevice([device('Plug', null)]);
  assert.ok('device' in single);
  const empty = resolveDevice([]);
  assert.equal('outcome' in empty && empty.outcome, 'no_devices');
});
