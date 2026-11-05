import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  CONNACK,
  PUBLISH,
  connectPacket,
  parsePublish,
  publishPacket,
  readPacket,
  subscribePacket,
} from '../src/direct/mqttCodec.ts';
import { applyMessage, capabilitiesOf, emptyState, tasmotaCommand } from '../src/direct/tasmota.ts';

/**
 * Direct mode end to end: residents pair a device, a stand-in Tasmota plug
 * logs in over MQTT with what the pairing gave it, and commands go to the
 * plug and settle on its answer. Nothing here touches a real plug.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const mqttPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const ADMIN = 'admin-key-for-tests';
const PAIRING_TTL_MS = 3000;

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-direct-')),
  ADMIN_API_KEY: ADMIN,
  HOST: '127.0.0.1',
  DIRECT_MQTT_PORT: String(mqttPort),
  DIRECT_MQTT_PUBLIC_HOST: 'mqtt.example.test',
  DIRECT_COMMAND_TIMEOUT_MS: '400',
  DIRECT_PAIRING_TTL_MS: String(PAIRING_TTL_MS),
});

const { createApp } = await import('../src/app.ts');
const { startDirect, stopDirect } = await import('../src/direct/devices.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

let server: Server;

before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
  await startDirect();
});

after(async () => {
  await stopDirect();
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => resetLimits());

// ---- A stand-in Tasmota plug -------------------------------------------------------------------

/**
 * Answers the way Tasmota does: RESULT for every command (and POWERn for
 * relays), STATUS… for `Status 0`, INFO1 on connecting, and its own button.
 */
class FakePlug {
  readonly received: string[] = [];
  /** False: takes commands and says nothing, like a plug about to drop off Wi-Fi. */
  answer = true;
  closed: Promise<void> = Promise.resolve();
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private topic = '';
  private readonly power: ('ON' | 'OFF')[];
  private dimmer: number | null;
  private readonly names: string[];

  constructor(options: { relays?: number; names?: string[]; dimmer?: number } = {}) {
    this.power = Array.from({ length: options.relays ?? 1 }, () => 'OFF');
    this.names = options.names ?? [];
    this.dimmer = options.dimmer ?? null;
  }

  /** Logs in and resolves with the CONNACK return code. */
  connect(username: string, password: string): Promise<number> {
    this.topic = username;
    const socket = connect(mqttPort, '127.0.0.1');
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = new Promise((resolve) => socket.once('close', () => resolve()));
    return new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.on('connect', () => socket.write(connectPacket(`DVES_${username}`, username, password)));
      socket.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (let next = readPacket(this.buffer); next; next = readPacket(this.buffer)) {
          this.buffer = this.buffer.subarray(next.size);
          if ((next.type & 0xf0) === CONNACK) {
            const code = next.body[1];
            if (code === 0) this.online();
            resolve(code);
          } else if ((next.type & 0xf0) === PUBLISH) {
            const message = parsePublish(next.type & 0x0f, next.body);
            this.command(message.topic.split('/').pop() ?? '', message.payload.toString('utf8'));
          }
        }
      });
    });
  }

  close() {
    this.socket?.destroy();
  }

  /** The plug's own button. */
  press(relay: number) {
    this.power[relay - 1] = this.power[relay - 1] === 'ON' ? 'OFF' : 'ON';
    this.send('stat', 'RESULT', JSON.stringify({ [this.key(relay)]: this.power[relay - 1] }));
  }

  private key = (relay: number) => (this.power.length === 1 ? 'POWER' : `POWER${relay}`);

  private send(prefix: string, name: string, payload: string) {
    this.socket?.write(publishPacket(`${prefix}/${this.topic}/${name}`, payload));
  }

  private state() {
    return {
      ...Object.fromEntries(this.power.map((value, index) => [this.key(index + 1), value])),
      ...(this.dimmer !== null ? { Dimmer: this.dimmer } : {}),
    };
  }

  private online() {
    this.socket?.write(subscribePacket(1, [`cmnd/${this.topic}/#`]));
    this.send('tele', 'LWT', 'Online');
    this.send('tele', 'INFO1', JSON.stringify({ Info1: { Module: 'Sonoff S2X', Version: '14.3.0(tasmota-tls)' } }));
  }

  private command(name: string, payload: string) {
    this.received.push(`${name} ${payload}`.trim());
    if (!this.answer) return;
    const upper = name.toUpperCase();
    const relay = /^POWER(\d*)$/.exec(upper);
    if (upper === 'STATUS') {
      this.send('stat', 'STATUS', JSON.stringify({ Status: { DeviceName: 'Desk', FriendlyName: this.names } }));
      this.send('stat', 'STATUS5', JSON.stringify({ StatusNET: { Mac: 'AA:BB:CC:DD:EE:FF' } }));
      this.send('stat', 'STATUS10', JSON.stringify({ StatusSNS: { Time: '2026-11-02T10:00:00', ENERGY: { Power: 12.5, Voltage: 230, Today: 0.4 } } }));
    } else if (upper === 'STATE') {
      this.send('stat', 'RESULT', JSON.stringify(this.state()));
    } else if (relay) {
      const index = Number(relay[1]) || 1;
      this.power[index - 1] = payload === 'TOGGLE' ? (this.power[index - 1] === 'ON' ? 'OFF' : 'ON') : (payload as 'ON' | 'OFF');
      this.send('stat', 'RESULT', JSON.stringify({ [this.key(index)]: this.power[index - 1] }));
      this.send('stat', this.key(index), this.power[index - 1]);
    } else if (upper === 'DIMMER' && this.dimmer !== null) {
      this.dimmer = Number(payload);
      this.power[0] = this.dimmer > 0 ? 'ON' : 'OFF';
      this.send('stat', 'RESULT', JSON.stringify({ POWER: this.power[0], Dimmer: this.dimmer }));
    } else {
      this.send('stat', 'RESULT', JSON.stringify({ Command: 'Unknown' }));
    }
  }
}

// ---- Helpers -----------------------------------------------------------------------------------

interface Envelope<T> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function api<T = Record<string, unknown>>(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Envelope<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, ...((await response.json()) as { ok: boolean; data: T; error?: { code: string; message: string } }) };
}

const admin = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => api<T>(method, path, { token: ADMIN, body });

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`condition not met: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let counter = 0;
async function resident() {
  counter += 1;
  const email = `direct-resident${counter}@example.com`;
  const result = await api<{ token: string }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery' } });
  assert.equal(result.status, 200, JSON.stringify(result.error));
  return { token: result.data.token, email };
}

async function residentInUnit(name: string) {
  const person = await resident();
  const unit = await admin<{ id: string }>('POST', '/api/admin/units', { name, provision: false });
  assert.equal(unit.status, 200, JSON.stringify(unit.error));
  assert.equal((await admin('POST', `/api/admin/units/${unit.data.id}/members`, { email: person.email })).status, 200);
  return { ...person, unitId: unit.data.id };
}

async function listen(token: string) {
  const events: Record<string, unknown>[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${appPort}/api/events`);
  socket.addEventListener('message', (event) => events.push(JSON.parse(String(event.data))));
  await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
  socket.send(JSON.stringify({ type: 'auth', token }));
  await until(() => events, (list) => list.some((event) => event.type === 'ready'));
  return { socket, events };
}

interface Pairing {
  deviceId: string;
  expiresAt: number;
  mqtt: { host: string; port: number; tls: boolean; username: string; password: string; topic: string };
}

interface DeviceShape {
  id: string;
  name: string;
  kind: string;
  model: string | null;
  integration: string;
  online: boolean;
  pending: unknown;
  lastError: string | null;
  capabilities: { type: string; entityId: string; label: string; value?: unknown }[];
  sensors: { entityId: string; value: string; unit: string | null }[];
}

const power = (device: DeviceShape, entityId: string) => device.capabilities.find((entry) => entry.entityId === entityId)?.value;
const getDevice = (token: string, id: string) => api<DeviceShape>('GET', `/api/direct/devices/${id}`, { token });

// ---- Tests ---------------------------------------------------------------------------------------

let a: Awaited<ReturnType<typeof residentInUnit>>;
let b: Awaited<ReturnType<typeof residentInUnit>>;
let strip: { pairing: Pairing; plug: FakePlug };

describe('pairing', () => {
  test('needs a unit, a session and a name', async () => {
    a = await residentInUnit('Tower A · 1203');
    b = await residentInUnit('Tower B · 0401');
    const loner = await resident();
    const homeless = await api('POST', '/api/direct/pairings', { token: loner.token, body: { name: 'Lamp' } });
    assert.equal(homeless.status, 404);
    assert.equal(homeless.error?.code, 'no_home');
    assert.equal((await api('POST', '/api/direct/pairings', { body: { name: 'Lamp' } })).status, 401);
    assert.equal((await api('POST', '/api/direct/pairings', { token: a.token, body: {} })).status, 400);
    assert.equal((await api('POST', '/api/direct/pairings', { token: a.token, body: { name: 'Lamp', kind: 'toaster' } })).status, 400);
  });

  test('gives a login once; the plug that uses it joins the unit', async () => {
    const paired = await api<Pairing>('POST', '/api/direct/pairings', { token: a.token, body: { name: 'Power strip', kind: 'plug' } });
    assert.equal(paired.status, 200, JSON.stringify(paired.error));
    const { mqtt } = paired.data;
    assert.equal(mqtt.host, 'mqtt.example.test');
    assert.equal(mqtt.port, mqttPort);
    assert.equal(mqtt.tls, false);
    assert.match(mqtt.username, /^pl[0-9a-f]{10}$/);
    assert.equal(mqtt.topic, mqtt.username);
    assert.ok(mqtt.password.length >= 20);

    const waiting = await api<{ status: string }>('GET', `/api/direct/pairings/${paired.data.deviceId}`, { token: a.token });
    assert.equal(waiting.data.status, 'waiting');
    // Not a device until the plug has connected.
    assert.deepEqual((await api<DeviceShape[]>('GET', '/api/direct/devices', { token: a.token })).data, []);

    assert.equal(await new FakePlug().connect(mqtt.username, 'not-the-password'), 4);
    assert.equal(await new FakePlug().connect('plffffffffff', mqtt.password), 4);

    const plug = new FakePlug({ relays: 2, names: ['Desk', 'Heater'] });
    assert.equal(await plug.connect(mqtt.username, mqtt.password), 0);
    const connected = await until(
      () => api<{ status: string; device: DeviceShape | null }>('GET', `/api/direct/pairings/${paired.data.deviceId}`, { token: a.token }),
      (result) => result.data.status === 'connected',
    );
    assert.equal(connected.data.device?.name, 'Power strip');

    const device = await until(
      () => getDevice(a.token, paired.data.deviceId),
      (result) => result.data.capabilities?.length === 2 && result.data.model !== null && result.data.sensors?.length > 0,
    );
    assert.equal(device.data.online, true);
    assert.equal(device.data.integration, 'tasmota');
    assert.equal(device.data.model, 'Sonoff S2X');
    assert.equal(device.data.kind, 'plug');
    assert.deepEqual(
      device.data.capabilities.map((entry) => [entry.type, entry.entityId, entry.label, entry.value]),
      [
        ['power', 'POWER1', 'Desk', 'off'],
        ['power', 'POWER2', 'Heater', 'off'],
      ],
    );
    assert.ok(device.data.sensors.some((reading) => reading.entityId === 'ENERGY.Power' && reading.value === '12.5' && reading.unit === 'W'));
    assert.deepEqual(plug.received.slice(0, 2), ['STATUS 0', 'STATE']);
    strip = { pairing: paired.data, plug };
  });

  test('another unit sees none of it', async () => {
    const id = strip.pairing.deviceId;
    assert.equal((await getDevice(b.token, id)).status, 404);
    assert.deepEqual((await api<DeviceShape[]>('GET', '/api/direct/devices', { token: b.token })).data, []);
    const command = await api('POST', `/api/direct/devices/${id}/commands`, { token: b.token, body: { capability: 'power', action: 'on' } });
    assert.equal(command.status, 404);
    assert.equal((await api<{ status: string }>('GET', `/api/direct/pairings/${id}`, { token: b.token })).data.status, 'expired');
    assert.equal((await api('DELETE', `/api/direct/devices/${id}`, { token: b.token })).status, 404);
  });

  test('an unused pairing expires and its login stops working', async () => {
    const paired = await api<Pairing>('POST', '/api/direct/pairings', { token: a.token, body: { name: 'Never plugged in' } });
    await new Promise((resolve) => setTimeout(resolve, PAIRING_TTL_MS + 100));
    assert.equal((await api<{ status: string }>('GET', `/api/direct/pairings/${paired.data.deviceId}`, { token: a.token })).data.status, 'expired');
    assert.equal(await new FakePlug().connect(paired.data.mqtt.username, paired.data.mqtt.password), 4);
  });
});

describe('controlling a device', () => {
  test('a command reaches the plug, shows pending, and settles on its answer', async () => {
    const { events, socket } = await listen(a.token);
    const id = strip.pairing.deviceId;
    const result = await api<DeviceShape>('POST', `/api/direct/devices/${id}/commands`, {
      token: a.token,
      body: { capability: 'power', action: 'on', entityId: 'POWER2' },
    });
    assert.equal(result.status, 200, JSON.stringify(result.error));
    assert.equal(power(result.data, 'POWER2'), 'on');
    assert.equal(power(result.data, 'POWER1'), 'off');
    assert.equal(result.data.pending, null);
    assert.ok(strip.plug.received.includes('POWER2 ON'));
    const updates = events.filter((event) => event.type === 'direct_device') as { device: DeviceShape }[];
    assert.ok(updates.some((event) => event.device.pending !== null), 'pending was pushed');
    await until(() => events, (list) => (list.at(-1) as { device?: DeviceShape }).device?.pending === null);
    socket.close();
  });

  test('the plug’s own button arrives live', async () => {
    const { events, socket } = await listen(a.token);
    strip.plug.press(1);
    await until(
      () => events,
      (list) => list.some((event) => event.type === 'direct_device' && power((event as { device: DeviceShape }).device, 'POWER1') === 'on'),
    );
    socket.close();
  });

  test('refuses what the plug cannot do, without sending it', async () => {
    const id = strip.pairing.deviceId;
    const sent = strip.plug.received.length;
    const dim = await api('POST', `/api/direct/devices/${id}/commands`, { token: a.token, body: { capability: 'brightness', action: 'set', value: 50 } });
    assert.equal(dim.status, 409);
    assert.equal(dim.error?.code, 'not_available');
    const lock = await api('POST', `/api/direct/devices/${id}/commands`, { token: a.token, body: { capability: 'lock', action: 'unlock' } });
    assert.equal(lock.status, 409);
    const nonsense = await api('POST', `/api/direct/devices/${id}/commands`, { token: a.token, body: { capability: 'power', action: 'explode' } });
    assert.equal(nonsense.status, 400);
    assert.equal(strip.plug.received.length, sent);
  });

  test('a plug that does not answer: command_timeout, its reason kept, nothing shown as switched', async () => {
    const id = strip.pairing.deviceId;
    strip.plug.answer = false;
    const before = power((await getDevice(a.token, id)).data, 'POWER2');
    const result = await api('POST', `/api/direct/devices/${id}/commands`, { token: a.token, body: { capability: 'power', action: 'toggle', entityId: 'POWER2' } });
    assert.equal(result.status, 504);
    assert.equal(result.error?.code, 'command_timeout');
    const device = (await getDevice(a.token, id)).data;
    assert.equal(power(device, 'POWER2'), before);
    assert.equal(device.pending, null);
    assert.match(device.lastError ?? '', /did not answer/);
    strip.plug.answer = true;
  });

  test('rename', async () => {
    const renamed = await api<DeviceShape>('PATCH', `/api/direct/devices/${strip.pairing.deviceId}`, { token: a.token, body: { name: 'Office strip' } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.name, 'Office strip');
    assert.equal((await api('PATCH', `/api/direct/devices/${strip.pairing.deviceId}`, { token: a.token, body: { name: '  ' } })).status, 400);
  });

  test('a plug that goes offline: commands refused until it is back', async () => {
    const id = strip.pairing.deviceId;
    strip.plug.close();
    await until(() => getDevice(a.token, id), (result) => result.data.online === false);
    const refused = await api('POST', `/api/direct/devices/${id}/commands`, { token: a.token, body: { capability: 'power', action: 'on' } });
    assert.equal(refused.status, 503);
    assert.equal(refused.error?.code, 'device_offline');
    assert.equal(await strip.plug.connect(strip.pairing.mqtt.username, strip.pairing.mqtt.password), 0);
    await until(() => getDevice(a.token, id), (result) => result.data.online === true);
  });

  test('the same plug logging in again replaces its old connection', async () => {
    const again = new FakePlug({ relays: 2 });
    assert.equal(await again.connect(strip.pairing.mqtt.username, strip.pairing.mqtt.password), 0);
    await strip.plug.closed;
    await until(() => getDevice(a.token, strip.pairing.deviceId), (result) => result.data.online === true);
    strip.plug = again;
  });

  test('a light: brightness, and it shows as a light', async () => {
    const paired = await api<Pairing>('POST', '/api/direct/pairings', { token: a.token, body: { name: 'Lamp', kind: 'plug' } });
    const lamp = new FakePlug({ dimmer: 20 });
    assert.equal(await lamp.connect(paired.data.mqtt.username, paired.data.mqtt.password), 0);
    await until(() => getDevice(a.token, paired.data.deviceId), (result) => result.status === 200 && result.data.kind === 'light');
    const dimmed = await api<DeviceShape>('POST', `/api/direct/devices/${paired.data.deviceId}/commands`, {
      token: a.token,
      body: { capability: 'brightness', action: 'set', value: 140 },
    });
    assert.equal(dimmed.status, 200, JSON.stringify(dimmed.error));
    assert.ok(lamp.received.includes('Dimmer 100'), 'clamped to 100');
    assert.equal(dimmed.data.capabilities.find((entry) => entry.type === 'brightness')?.value, 100);
    lamp.close();
  });

  test('removing a device disconnects it, and its login stops working', async () => {
    const { events, socket } = await listen(a.token);
    const id = strip.pairing.deviceId;
    assert.equal((await api('DELETE', `/api/direct/devices/${id}`, { token: a.token })).status, 200);
    await strip.plug.closed;
    assert.equal(await new FakePlug().connect(strip.pairing.mqtt.username, strip.pairing.mqtt.password), 4);
    assert.equal((await getDevice(a.token, id)).status, 404);
    await until(() => events, (list) => list.some((event) => event.type === 'direct_device_removed' && event.id === id));
    socket.close();
  });
});

describe('reading Tasmota', () => {
  test('discovery, STATUS0 and sensors, whichever the firmware sends', () => {
    const state = emptyState();
    const discovery = { mac: 'A4CF12AB34CD', md: 'Sonoff Basic', sw: '13.4.0', fn: ['Fan', null] };
    assert.equal(applyMessage(state, 'pl01', 'tasmota/discovery/A4CF12AB34CD/config', Buffer.from(JSON.stringify(discovery))).identity, true);
    assert.deepEqual([state.model, state.firmware, state.mac, state.names], ['Sonoff Basic', '13.4.0', 'A4CF12AB34CD', ['Fan', '']]);

    const status0 = { StatusSTS: { POWER: 'ON' }, StatusSNS: { TempUnit: 'F', AM2301: { Temperature: 71.2, Humidity: 40 } } };
    assert.equal(applyMessage(state, 'pl01', 'stat/pl01/STATUS0', Buffer.from(JSON.stringify(status0))).changed, true);
    assert.equal(state.power.get('POWER'), 'on');
    assert.equal(state.sensors.get('AM2301.Temperature')?.unit, '°F');
    // Another device's topic is ignored, and so is anything that is not JSON where JSON is expected.
    assert.equal(applyMessage(state, 'pl01', 'stat/pl02/RESULT', Buffer.from('{"POWER":"OFF"}')).changed, false);
    assert.equal(applyMessage(state, 'pl01', 'tele/pl01/STATE', Buffer.from('not json')).changed, false);
    assert.equal(state.power.get('POWER'), 'on');
    assert.equal(capabilitiesOf(state)[0].label, 'Fan');
  });

  test('commands are clamped to what Tasmota takes', () => {
    const state = emptyState();
    applyMessage(state, 'pl01', 'stat/pl01/RESULT', Buffer.from(JSON.stringify({ POWER: 'ON', Dimmer: 30, CT: 300, HSBColor: '10,20,30' })));
    assert.deepEqual(tasmotaCommand(state, { capability: 'color_temp', action: 'set', value: 10_000 }), { command: 'CT', payload: '153', expect: 'CT' });
    assert.deepEqual(tasmotaCommand(state, { capability: 'color', action: 'set', value: { h: 400, s: 50 } }), {
      command: 'HSBColor',
      payload: '360,50,30',
      expect: 'HSBColor',
    });
    assert.deepEqual(tasmotaCommand(state, { capability: 'power', action: 'toggle' }), { command: 'POWER', payload: 'TOGGLE', expect: 'POWER' });
    assert.throws(() => tasmotaCommand(state, { capability: 'brightness', action: 'set', value: 'bright' }), /must be a number/);
  });
});
