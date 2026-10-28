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
 * climate-mode). Nothing here touches a real appliance or broker.
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
const ac = { power: false, mode: 'cool', deaf: false };
const discovery = JSON.stringify({
  availability: [{ topic: `rethink/${AC}/availability` }, { topic: 'rethink/availability' }],
  availability_mode: 'all',
  device: { identifiers: AC, manufacturer: 'LG', model: 'RAC_056905_WW', name: 'LG Air Conditioner' },
  components: {
    climate: {
      platform: 'climate',
      unique_id: `${AC}-climate`,
      mode_state_topic: `rethink/${AC}/climate-mode`,
      mode_command_topic: `rethink/${AC}/climate-mode/set`,
      power_command_topic: `rethink/${AC}/climate-power/set`,
      current_temperature_topic: `rethink/${AC}/climate-current_temperature`,
    },
  },
});

const rethink = new MqttClient(`mqtt://127.0.0.1:${brokerPort}`);
const publishMode = () => rethink.publish(`rethink/${AC}/climate-mode`, ac.power ? ac.mode : 'off', true);
rethink.on('connect', () => {
  rethink.subscribe(['rethink/+/+/set', 'homeassistant/status']);
  rethink.publish('rethink/availability', 'online', true);
  rethink.publish(`rethink/${AC}/availability`, 'online', true);
  publishMode();
});
rethink.on('message', (topic: string, payload: Buffer) => {
  const text = payload.toString('utf8');
  if (topic === 'homeassistant/status' && text === 'online') {
    rethink.publish(`homeassistant/device/rethink/${AC}/config`, discovery);
  }
  if (topic === `rethink/${AC}/climate-power/set` && !ac.deaf) {
    ac.power = text === 'ON';
    publishMode();
  }
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
    publishMode();
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
});
