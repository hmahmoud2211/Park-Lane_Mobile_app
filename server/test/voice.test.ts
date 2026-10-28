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
    hasControls: false,
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

// ---- Free speech in any Arabic dialect ------------------------------------------------------

const { parseUtterance, sameWord } = await import('../src/ems/utterance.ts');

test('reads on, off and questions across dialects, with polite filler and attached pronouns', () => {
  const cases: [string, 'on' | 'off' | 'status' | null][] = [
    ['لو سمحت شغل النور', 'on'],
    ['ولّعي الضو بالمطبخ', 'on'],
    ['عايز اشغل التكييف', 'on'],
    ['بدي شغّل اللمبة', 'on'],
    ['خلي الفيش شغال', 'on'],
    ['الله يخليك افتحي الإضاءة', 'on'],
    ['ممكن تطفي النور', 'off'],
    ['سكّرها', 'off'],
    ['بنّد المروحة', 'off'],
    ['افصل الفيشة', 'off'],
    ['اقفلي المكيف', 'off'],
    ['النور شغال؟', 'status'],
    ['هل المكيف مطفي', 'status'],
    ['وش حالة السخان', 'status'],
    ['turn on the kitchen light', 'on'],
    ['switch off the fan', 'off'],
    ['is the fan off', 'status'],
    ['ابي النور', null],
  ];
  for (const [spoken, action] of cases) {
    assert.equal(parseUtterance(spoken).action, action, spoken);
  }
});

test('splits several devices and recognises "all"', () => {
  assert.deepEqual(parseUtterance('شغل النور والمكيف').targets, ['النور', 'المكيف']);
  const all = parseUtterance('طفي كل الأنوار');
  assert.equal(all.all, true);
  assert.deepEqual(all.targets, ['الانوار']);
  const everything = parseUtterance('طفي كل شي');
  assert.equal(everything.all, true);
  assert.deepEqual(everything.targets, []);
  assert.deepEqual(parseUtterance('سكر كل الاجهزه').targets, []);
});

test('dialect synonyms and prefixes match the registered names', () => {
  const devices = [device('نور', 'غرفة النوم'), device('مكيف', 'الصالة'), device('فيش', 'المطبخ')];
  const light = resolveDevice(devices, 'الضو في اوضة النوم');
  assert.ok('device' in light && light.device.name === 'نور');
  const ac = resolveDevice(devices, 'التكييف بالصالون');
  assert.ok('device' in ac && ac.device.name === 'مكيف');
  const plug = resolveDevice(devices, 'البريزة');
  assert.ok('device' in plug && plug.device.name === 'فيش');
  const english = resolveDevice(devices, 'bedroom light');
  assert.ok('device' in english && english.device.name === 'نور');
});

test('tolerates one recognition slip in longer words, never in short ones', () => {
  assert.equal(sameWord('مكيفات', 'مكيفاة'), true);
  assert.equal(sameWord('نور', 'نار'), false);
});

test('English: split verbs, bare on/off, questions, contractions', () => {
  const cases: [string, 'on' | 'off' | 'status' | null, string[]][] = [
    ['turn the kitchen light on', 'on', ['kitchen light']],
    ['can you please turn on the bedroom lamp', 'on', ['bedroom lamp']],
    ['living room light on please', 'on', ['living room light']],
    ['shut down the heater', 'off', ['heater']],
    ['turn the fan and the heater off', 'off', ['fan', 'heater']],
    ['kill the fan', 'off', ['fan']],
    ["what's the status of the fan", 'status', ['fan']],
    ['is the AC still on', 'status', ['ac']],
    ['did I leave the hall light on', 'status', ['hall light']],
  ];
  for (const [spoken, action, targets] of cases) {
    const parsed = parseUtterance(spoken);
    assert.equal(parsed.action, action, spoken);
    assert.deepEqual(parsed.targets, targets, spoken);
  }
});

test('plurals mean every device of that kind', () => {
  assert.equal(parseUtterance('lights off').all, true);
  assert.equal(parseUtterance('are the lights on').all, true);
  assert.equal(parseUtterance('طفي الانوار').all, true);
  assert.equal(parseUtterance('switch everything off').all, true);
  assert.equal(parseUtterance('turn off the light').all, false);
});
