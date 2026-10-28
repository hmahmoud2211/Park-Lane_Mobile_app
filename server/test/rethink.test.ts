import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

/**
 * LG appliances through rethink, end to end over HTTP: an in-process MQTT
 * broker, and a stand-in for rethink with one AC that answers the way
 * rethink's RAC_056905_WW driver does (power on climate-power/set, state on
 * climate-mode, the climate settings, and extras such as Jet, which only
 * works in Cooling or Heating, Air purify, which is never echoed, the sleep
 * timer and the filter). Nothing here touches a real appliance or broker.
 */

async function freePort(): Promise<number> {
  const probe = createHttpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const brokerPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-rethink-')),
  RETHINK_MQTT_URL: `mqtt://127.0.0.1:${brokerPort}`,
  CUBE_TOKEN: 'unused',
});

const { createApp } = await import('../src/app.ts');
const { startAdapters } = await import('../src/ems/devices.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { MqttClient, parsePublish, publishPacket, readPacket } = await import('../src/rethink/mqtt.ts');
const { entryFromDiscovery, powerOf, startRethink, stopRethink, isConnected } = await import('../src/rethink/appliances.ts');

// ---- Broker stand-in: QoS 0, retained messages, + and # filters ---------------------------

function matches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let index = 0; index < f.length; index += 1) {
    if (f[index] === '#') {
      return true;
    }
    if (index >= t.length || (f[index] !== '+' && f[index] !== t[index])) {
      return false;
    }
  }
  return f.length === t.length;
}

const retained = new Map<string, string>();
const sessions = new Map<Socket, string[]>();

const broker = createTcpServer((socket) => {
  sessions.set(socket, []);
  let buffer = Buffer.alloc(0);
  socket.on('error', () => undefined);
  socket.on('close', () => sessions.delete(socket));
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let next = readPacket(buffer); next; next = readPacket(buffer)) {
      buffer = buffer.subarray(next.size);
      const kind = next.type & 0xf0;
      if (kind === 0x10) {
        socket.write(Buffer.from([0x20, 2, 0, 0]));
      } else if (kind === 0x80) {
        const filters: string[] = [];
        for (let offset = 2; offset < next.body.length; ) {
          const length = next.body.readUInt16BE(offset);
          filters.push(next.body.subarray(offset + 2, offset + 2 + length).toString('utf8'));
          offset += 2 + length + 1;
        }
        sessions.get(socket)?.push(...filters);
        socket.write(Buffer.from([0x90, 2 + filters.length, next.body[0], next.body[1], ...filters.map(() => 0)]));
        for (const [topic, payload] of retained) {
          if (filters.some((filter) => matches(filter, topic))) {
            socket.write(publishPacket(topic, payload, true));
          }
        }
      } else if (kind === 0x30) {
        const message = parsePublish(next.type & 0x0f, next.body);
        const payload = message.payload.toString('utf8');
        if (message.retain) {
          retained.set(message.topic, payload);
        }
        for (const [peer, filters] of sessions) {
          if (filters.some((filter) => matches(filter, message.topic))) {
            peer.write(publishPacket(message.topic, payload, false));
          }
        }
      } else if (kind === 0xc0) {
        socket.write(Buffer.from([0xd0, 0]));
      }
    }
  });
});

// ---- Rethink stand-in with one DualCool AC -----------------------------------------------

const AC = 'ac-1111';
const ac = {
  power: false,
  mode: 'cool',
  deaf: false,
  temperature: 24,
  fan: 'auto',
  swing: 'off',
  jet: false,
  sleep: 0,
  filterUsed: 120,
};
const at = (name: string) => `rethink/${AC}/${name}`;
const availableWhen = (name: string) => [{ topic: at('availability') }, { topic: 'rethink/availability' }, { topic: at(`${name}-available`) }];
const discovery = JSON.stringify({
  availability: [{ topic: at('availability') }, { topic: 'rethink/availability' }],
  availability_mode: 'all',
  device: { identifiers: AC, manufacturer: 'LG', model: 'RAC_056905_WW', name: 'LG Air Conditioner' },
  components: {
    climate: {
      platform: 'climate',
      unique_id: `${AC}-climate`,
      action_topic: at('climate-action'),
      temperature_unit: 'C',
      temp_step: 0.5,
      min_temp: 16,
      max_temp: 30,
      fan_modes: ['auto', 'very low', 'low', 'medium', 'high', 'very high'],
      swing_modes: ['1', '2', '3', '4', '5', '6', 'on', 'off'],
      mode_state_topic: at('climate-mode'),
      mode_command_topic: at('climate-mode/set'),
      power_command_topic: at('climate-power/set'),
      current_temperature_topic: at('climate-current_temperature'),
      temperature_state_topic: at('climate-temperature'),
      temperature_command_topic: at('climate-temperature/set'),
      fan_mode_state_topic: at('climate-fan_mode'),
      fan_mode_command_topic: at('climate-fan_mode/set'),
      swing_mode_state_topic: at('climate-swing_mode'),
      swing_mode_command_topic: at('climate-swing_mode/set'),
    },
    jet: {
      platform: 'switch',
      name: 'Jet cool/heat',
      entity_category: 'config',
      optimistic: true,
      state_topic: at('jet-'),
      command_topic: at('jet-/set'),
      json_attributes_topic: at('jet-attributes'),
      availability: availableWhen('jet'),
    },
    airclean: {
      platform: 'switch',
      name: 'Air purify',
      entity_category: 'config',
      optimistic: true,
      state_topic: at('airclean-'),
      command_topic: at('airclean-/set'),
    },
    sleeptimer: {
      platform: 'number',
      name: 'Sleep timer',
      unit_of_measurement: 'h',
      min: 0,
      max: 15,
      step: 0.25,
      state_topic: at('sleeptimer-'),
      command_topic: at('sleeptimer-/set'),
      json_attributes_topic: at('sleeptimer-attributes'),
      availability: availableWhen('sleeptimer'),
    },
    filterused: { platform: 'sensor', name: 'Filter used time', unit_of_measurement: 'h', entity_category: 'diagnostic', state_topic: at('filterused') },
    filterlife: { platform: 'sensor', name: 'Filter life time', unit_of_measurement: 'h', entity_category: 'diagnostic', state_topic: at('filterlife') },
    changeddate: { platform: 'sensor', name: 'Filter usage last reset', entity_category: 'diagnostic', state_topic: at('filterchangeddate') },
    filterreset: { platform: 'button', name: 'Reset filter usage', entity_category: 'diagnostic', command_topic: at('filterreset/set') },
    autodry: { platform: 'binary_sensor', name: 'Auto dry', entity_category: 'diagnostic', state_topic: at('autodry-') },
    // Withdrawn by an earlier rethink release: only the platform is left.
    gone: { platform: 'switch' },
  },
});

const rethink = new MqttClient(`mqtt://127.0.0.1:${brokerPort}`);
const jetModes = () => ac.power && (ac.mode === 'cool' || ac.mode === 'heat');
function publishState() {
  const state: Record<string, string> = {
    'climate-mode': ac.power ? ac.mode : 'off',
    'climate-action': ac.power ? 'cooling' : 'off',
    'climate-temperature': String(ac.temperature),
    'climate-fan_mode': ac.fan,
    'climate-swing_mode': ac.swing,
    'jet-': ac.jet ? 'ON' : 'OFF',
    'jet-available': jetModes() ? 'online' : 'offline',
    'sleeptimer-': String(ac.sleep),
    'sleeptimer-available': ac.power ? 'online' : 'offline',
    filterused: String(ac.filterUsed),
  };
  for (const [name, value] of Object.entries(state)) {
    rethink.publish(at(name), value, true);
  }
}
rethink.on('connect', () => {
  rethink.subscribe(['rethink/+/+/set', 'homeassistant/status']);
  rethink.publish('rethink/availability', 'online', true);
  rethink.publish(at('availability'), 'online', true);
  rethink.publish(at('climate-current_temperature'), '26', true);
  rethink.publish(at('airclean-'), 'OFF', true);
  rethink.publish(at('filterlife'), '720', true);
  rethink.publish(at('filterchangeddate'), '0000-00-00', true);
  rethink.publish(at('autodry-'), 'OFF', true);
  rethink.publish(at('jet-attributes'), JSON.stringify({ description: 'Strong airflow.', requires: 'AC on, in Cooling or Heating' }), true);
  rethink.publish(at('sleeptimer-attributes'), JSON.stringify({ description: 'Turns the AC off.', requires: 'AC on' }), true);
  publishState();
});
rethink.on('message', (topic: string, payload: Buffer) => {
  const text = payload.toString('utf8');
  if (topic === 'homeassistant/status' && text === 'online') {
    rethink.publish(`homeassistant/device/rethink/${AC}/config`, discovery);
  }
  const set = new RegExp(`^rethink/${AC}/(.+)/set$`).exec(topic);
  if (!set || ac.deaf) {
    return;
  }
  switch (set[1]) {
    case 'climate-power':
      ac.power = text === 'ON';
      break;
    case 'climate-mode':
      ac.mode = text;
      break;
    case 'climate-temperature':
      ac.temperature = Number(text);
      break;
    case 'climate-fan_mode':
      ac.fan = text;
      break;
    case 'climate-swing_mode':
      ac.swing = text;
      break;
    case 'jet-':
      ac.jet = jetModes() && text === 'ON';
      break;
    case 'sleeptimer-':
      ac.sleep = ac.power ? Number(text) : ac.sleep;
      break;
    case 'filterreset':
      ac.filterUsed = 0;
      break;
    default:
      // Air purify is kept for power-up and never echoed, as by an AC that is off.
      return;
  }
  publishState();
});

// ---- Helpers ------------------------------------------------------------------------------

let server: Server;

async function waitFor(check: () => boolean | Promise<boolean>, ms = 3_000) {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) {
      throw new Error('Timed out waiting for a condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function api<T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, ...((await response.json()) as { ok: boolean; data: T; error?: { code: string } }) };
}

interface Appliance {
  id: string;
  model: string | null;
  kind: string;
  online: boolean;
  power: string;
  added: boolean;
}

before(async () => {
  await new Promise<void>((resolve) => broker.listen(brokerPort, '127.0.0.1', resolve));
  rethink.start();
  await waitFor(() => rethink.connected);
  startRethink();
  startAdapters();
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
  await waitFor(() => isConnected());
});

after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  stopRethink();
  rethink.stop();
  for (const socket of sessions.keys()) {
    socket.destroy();
  }
  await new Promise((resolve) => broker.close(resolve));
});

// ---- Tests --------------------------------------------------------------------------------

describe('rethink discovery', () => {
  test('reads the power and mode topics from a climate component', () => {
    const entry = entryFromDiscovery(AC, discovery);
    assert.ok(entry);
    assert.equal(entry.powerCommandTopic, `rethink/${AC}/climate-power/set`);
    assert.equal(entry.model, 'RAC_056905_WW');
    assert.equal(powerOf(entry, () => 'off'), 'off');
    assert.equal(powerOf(entry, () => 'heat'), 'on');
    assert.equal(powerOf(entry, () => 'None'), 'unknown');
  });

  test('ignores appliances without a power switch', () => {
    assert.equal(entryFromDiscovery('fridge', JSON.stringify({ components: { temp: { platform: 'sensor' } } })), null);
    assert.equal(entryFromDiscovery('broken', 'not json'), null);
  });
});

describe('LG appliances in the registry', () => {
  let token = '';
  let deviceId = '';

  before(async () => {
    const result = await api<{ token: string }>('POST', '/api/auth/register', undefined, {
      email: 'lg@example.com',
      password: 'correct horse battery',
      name: 'LG Owner',
    });
    token = result.data.token;
  });

  test('lists the AC rethink announced', async () => {
    await waitFor(async () => (await api<{ appliances: Appliance[] }>('GET', '/api/lg/appliances', token)).data.appliances.length > 0);
    const result = await api<{ connected: boolean; appliances: Appliance[] }>('GET', '/api/lg/appliances', token);
    assert.equal(result.data.connected, true);
    assert.deepEqual(
      result.data.appliances.map(({ id, model, kind, online, power, added }) => ({ id, model, kind, online, power, added })),
      [{ id: AC, model: 'RAC_056905_WW', kind: 'ac', online: true, power: 'off', added: false }],
    );
  });

  test('needs a signed-in user', async () => {
    assert.equal((await api('GET', '/api/lg/appliances')).status, 401);
  });

  test('adds it as an AC and marks it added', async () => {
    const created = await api<{ id: string; type: string; protocol: string; power: string }>('POST', '/api/devices', token, {
      name: 'Bedroom AC',
      room: 'Bedroom',
      protocol: 'rethink',
      lg: { applianceId: AC },
    });
    assert.equal(created.status, 200, JSON.stringify(created.error));
    assert.equal(created.data.type, 'ac');
    assert.equal(created.data.protocol, 'rethink');
    assert.equal(created.data.power, 'off');
    deviceId = created.data.id;
    const list = await api<{ appliances: Appliance[] }>('GET', '/api/lg/appliances', token);
    assert.equal(list.data.appliances[0].added, true);
  });

  test('refuses an appliance rethink does not know', async () => {
    const result = await api('POST', '/api/devices', token, { name: 'Ghost', protocol: 'rethink', lg: { applianceId: 'nope' } });
    assert.equal(result.status, 404);
    assert.equal(result.error?.code, 'device_not_found');
  });

  test('switches on only once the AC reports it', async () => {
    const result = await api<{ power: string }>('POST', `/api/devices/${deviceId}/power`, token, { power: 'on' });
    assert.equal(result.status, 200, JSON.stringify(result.error));
    assert.equal(result.data.power, 'on');
    assert.equal(ac.power, true);
  });

  test('picks up a change made with the remote', async () => {
    ac.power = false;
    publishState();
    await waitFor(async () => (await api<{ power: string }>('GET', `/api/devices/${deviceId}`, token)).data.power === 'off');
  });

  test('reports unreachable when the AC never confirms', { timeout: 15_000 }, async () => {
    ac.deaf = true;
    try {
      const result = await api('POST', `/api/devices/${deviceId}/power`, token, { power: 'on' });
      assert.equal(result.status, 502);
      assert.equal(result.error?.code, 'device_unreachable');
    } finally {
      ac.deaf = false;
    }
  });

  test('is offline when rethink loses the AC', async () => {
    rethink.publish(`rethink/${AC}/availability`, 'offline', true);
    await waitFor(async () => (await api<{ online: boolean }>('GET', `/api/devices/${deviceId}`, token)).data.online === false);
    const result = await api('POST', `/api/devices/${deviceId}/power`, token, { power: 'on' });
    assert.equal(result.error?.code, 'device_offline');
    rethink.publish(`rethink/${AC}/availability`, 'online', true);
    await waitFor(async () => (await api<{ online: boolean }>('GET', `/api/devices/${deviceId}`, token)).data.online === true);
  });

  describe('settings beyond power', () => {
    const controls = async () => (await api<Controls>('GET', `/api/devices/${deviceId}/controls`, token)).data;
    const setting = (all: Controls, key: string) => all.settings.find((entry) => entry.key === key);
    const set = (key: string, value: unknown) => api<Controls>('POST', `/api/devices/${deviceId}/controls`, token, { key, value });

    test('lists what rethink announced, climate settings first', async () => {
      const device = await api<{ hasControls: boolean }>('GET', `/api/devices/${deviceId}`, token);
      assert.equal(device.data.hasControls, true);
      const all = await controls();
      assert.deepEqual(
        all.settings.map(({ key, kind }) => `${key}:${kind}`),
        [
          'mode:select',
          'temperature:number',
          'fan_mode:select',
          'swing_mode:select',
          'jet:switch',
          'airclean:switch',
          'sleeptimer:number',
          'filterused:sensor',
          'filterlife:sensor',
          'changeddate:sensor',
          'filterreset:button',
          'autodry:sensor',
        ],
      );
      assert.equal(all.currentTemperature, 26);
      assert.deepEqual(setting(all, 'mode')?.options, ['auto', 'cool', 'heat', 'dry', 'fan_only']);
      assert.deepEqual(setting(all, 'temperature'), {
        key: 'temperature',
        kind: 'number',
        name: 'Temperature',
        value: 24,
        min: 16,
        max: 30,
        step: 0.5,
        unit: '°C',
        available: false,
        requires: 'AC on',
        description: null,
        diagnostic: false,
      });
      assert.equal(setting(all, 'jet')?.requires, 'AC on, in Cooling or Heating');
      assert.equal(setting(all, 'jet')?.description, 'Strong airflow.');
      assert.equal(setting(all, 'airclean')?.available, true);
      assert.equal(setting(all, 'filterused')?.value, 120);
      assert.equal(setting(all, 'filterlife')?.unit, 'h');
      assert.equal(setting(all, 'changeddate')?.value, null);
      assert.equal(setting(all, 'autodry')?.value, false);
    });

    test('a device without settings says so', async () => {
      const lamp = await api<{ id: string; hasControls: boolean }>('POST', '/api/devices', token, { name: 'Lamp', protocol: 'virtual', type: 'light' });
      assert.equal(lamp.data.hasControls, false);
      const result = await api('GET', `/api/devices/${lamp.data.id}/controls`, token);
      assert.equal(result.status, 409);
      assert.equal(result.error?.code, 'not_controllable');
    });

    test('refuses climate settings while the AC is off', async () => {
      const result = await set('temperature', 21);
      assert.equal(result.status, 409);
      assert.equal(result.error?.code, 'not_controllable');
      assert.equal(ac.temperature, 24);
    });

    test('changes the set point, fan and swing once the AC reports them', async () => {
      assert.equal((await api('POST', `/api/devices/${deviceId}/power`, token, { power: 'on' })).status, 200);
      const temperature = await set('temperature', 21.5);
      assert.equal(temperature.status, 200, JSON.stringify(temperature.error));
      assert.equal(setting(temperature.data, 'temperature')?.value, 21.5);
      assert.equal(ac.temperature, 21.5);
      assert.equal(setting((await set('fan_mode', 'very high')).data, 'fan_mode')?.value, 'very high');
      assert.equal(setting((await set('swing_mode', 'on')).data, 'swing_mode')?.value, 'on');
      assert.deepEqual([ac.fan, ac.swing], ['very high', 'on']);
    });

    test('refuses values the AC does not take', async () => {
      for (const [key, value] of [
        ['temperature', 31],
        ['temperature', 21.3],
        ['temperature', '22'],
        ['fan_mode', 'turbo'],
        ['mode', 'off'],
        ['jet', 'yes'],
        ['filterused', 0],
        ['nope', 1],
      ] as const) {
        const result = await set(key, value);
        assert.equal(result.status, 400, `${key} = ${String(value)}`);
        assert.equal(result.error?.code, 'bad_request');
      }
      assert.equal((await api('POST', `/api/devices/${deviceId}/controls`, token, { value: 1 })).status, 400);
    });

    test('Jet only where the AC takes it, and says why', async () => {
      assert.equal((await set('mode', 'fan_only')).status, 200);
      await waitFor(async () => setting(await controls(), 'jet')?.available === false);
      const refused = await set('jet', true);
      assert.equal(refused.status, 409);
      assert.equal(refused.error?.code, 'not_controllable');
      assert.match(String((refused.error as { message?: string }).message), /Cooling or Heating/);
      assert.equal((await set('mode', 'cool')).status, 200);
      await waitFor(async () => setting(await controls(), 'jet')?.available === true);
      const jet = await set('jet', true);
      assert.equal(jet.status, 200, JSON.stringify(jet.error));
      assert.equal(setting(jet.data, 'jet')?.value, true);
      await waitFor(() => ac.jet);
    });

    test('assumes a setting the AC never echoes, as Home Assistant does', async () => {
      const result = await set('airclean', true);
      assert.equal(result.status, 200, JSON.stringify(result.error));
      assert.equal(setting(result.data, 'airclean')?.value, true);
    });

    test('sets a timer and presses the filter reset', async () => {
      const timer = await set('sleeptimer', 1.5);
      assert.equal(timer.status, 200, JSON.stringify(timer.error));
      assert.equal(setting(timer.data, 'sleeptimer')?.value, 1.5);
      assert.equal(ac.sleep, 1.5);
      assert.equal((await set('filterreset', null)).status, 200);
      await waitFor(async () => setting(await controls(), 'filterused')?.value === 0);
    });

    test('pushes changes made on the AC to the app', async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
      const events: { type: string; id?: string; controls?: Controls }[] = [];
      socket.onmessage = (message) => events.push(JSON.parse(String(message.data)));
      await new Promise((resolve) => (socket.onopen = resolve));
      socket.send(JSON.stringify({ type: 'auth', token }));
      try {
        await waitFor(() => events.some((event) => event.type === 'ready'));
        ac.temperature = 19;
        publishState();
        await waitFor(() =>
          events.some((event) => event.type === 'controls' && event.id === deviceId && setting(event.controls as Controls, 'temperature')?.value === 19),
        );
      } finally {
        socket.close();
      }
    });
  });
});

interface Controls {
  online: boolean;
  power: string;
  action: string | null;
  currentTemperature: number | null;
  settings: { key: string; kind: string; value: unknown; options?: string[]; unit: string | null; available: boolean; requires: string | null; description: string | null }[];
}
