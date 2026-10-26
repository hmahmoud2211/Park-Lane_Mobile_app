import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * A stand-in for one Home Assistant instance: its WebSocket API (auth,
 * registries, subscribe_entities, subscribe_events, call_service and the
 * registry updates the facade uses) and the onboarding REST calls the
 * provisioner makes. State lives in memory and changes the way HA reports
 * it, so tests can drive the backend end to end without a real hub.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface FakeEntity {
  entity_id: string;
  device_id: string | null;
  area_id?: string | null;
  platform?: string;
  name?: string | null;
  original_name?: string | null;
  entity_category?: string | null;
  hidden_by?: string | null;
  config_entry_id?: string | null;
}

export interface FakeDevice {
  id: string;
  name: string;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  area_id?: string | null;
  config_entry_id?: string | null;
  entry_type?: string | null;
}

export interface FakeSetup {
  areas: { area_id: string; name: string; icon?: string | null }[];
  devices: FakeDevice[];
  entities: FakeEntity[];
  states: Record<string, { s: string; a?: Record<string, unknown> }>;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }
  if (length < 65_536) {
    return Buffer.concat([Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]), payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

class FakeSocket {
  private buffer = Buffer.alloc(0);
  authed = false;
  readonly subscriptions = new Map<number, string>();
  private readonly socket: Duplex;
  private readonly onMessage: (socket: FakeSocket, message: Record<string, unknown>) => void;

  constructor(socket: Duplex, onMessage: (socket: FakeSocket, message: Record<string, unknown>) => void) {
    this.socket = socket;
    this.onMessage = onMessage;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
  }

  send(message: unknown) {
    if (this.socket.writable) {
      this.socket.write(frame(0x1, Buffer.from(JSON.stringify(message))));
    }
  }

  destroy() {
    this.socket.destroy();
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + 4 + length) return;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      this.buffer = this.buffer.subarray(offset + 4 + length);
      if (opcode === 0x8) {
        this.socket.end(frame(0x8, Buffer.alloc(0)));
      } else if (opcode === 0x9) {
        this.socket.write(frame(0xa, payload));
      } else if (opcode === 0x1) {
        this.onMessage(this, JSON.parse(payload.toString('utf8')));
      }
    }
  }
}

export class FakeHa {
  readonly server: Server;
  readonly tokens = new Set<string>();
  readonly calls: { domain: string; service: string; entityId: string; data: Record<string, unknown> }[] = [];
  /** Entities whose service calls fail, as when a cloud device is offline. */
  readonly failing = new Set<string>();
  /** When false, service calls succeed but the device never reports back. */
  reportBack = true;
  onboarded = false;
  private readonly sockets = new Set<FakeSocket>();
  private readonly raw = new Set<Duplex>();
  private refusing = false;
  private setup: FakeSetup;
  private states: Record<string, { s: string; a: Record<string, unknown>; lc: number }> = {};

  constructor(setup: FakeSetup, token = 'fake-ha-token-0123456789') {
    this.setup = structuredClone(setup);
    this.tokens.add(token);
    for (const [entityId, state] of Object.entries(setup.states)) {
      this.states[entityId] = { s: state.s, a: state.a ?? {}, lc: Date.now() / 1000 };
    }
    this.server = createServer((req, res) => void this.rest(req, res));
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex) => this.upgrade(req, socket));
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    this.dropAll();
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** Cuts every connection and, with `refuse`, turns new ones away, as when the hub goes down. */
  dropAll(refuse = false) {
    this.refusing = refuse;
    for (const socket of this.raw) socket.destroy();
    this.raw.clear();
    this.sockets.clear();
  }

  allowConnections() {
    this.refusing = false;
  }

  /** Changes a state as the device itself would, and reports it to subscribers. */
  setState(entityId: string, state: string, attributes: Record<string, unknown> = {}) {
    const current = this.states[entityId];
    const lc = Date.now() / 1000;
    if (!current) {
      this.states[entityId] = { s: state, a: attributes, lc };
      this.broadcastEntities({ a: { [entityId]: { s: state, a: attributes, c: 'ctx', lc } } });
      return;
    }
    const added: Record<string, unknown> = {};
    if (current.s !== state) {
      added.s = state;
      added.lc = lc;
      current.lc = lc;
    }
    const changedAttrs = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => current.a[key] !== value));
    if (Object.keys(changedAttrs).length > 0) added.a = changedAttrs;
    current.s = state;
    current.a = { ...current.a, ...attributes };
    if (Object.keys(added).length > 0) {
      this.broadcastEntities({ c: { [entityId]: { '+': added } } });
    }
  }

  stateOf(entityId: string) {
    return this.states[entityId];
  }

  private broadcastEntities(event: unknown) {
    for (const socket of this.sockets) {
      for (const [id, kind] of socket.subscriptions) {
        if (kind === 'entities') socket.send({ id, type: 'event', event });
      }
    }
  }

  private fire(eventType: string, data: Record<string, unknown>) {
    for (const socket of this.sockets) {
      for (const [id, kind] of socket.subscriptions) {
        if (kind === eventType) socket.send({ id, type: 'event', event: { event_type: eventType, data } });
      }
    }
  }

  private upgrade(req: IncomingMessage, socket: Duplex) {
    if (this.refusing || req.url !== '/api/websocket') {
      socket.destroy();
      return;
    }
    this.raw.add(socket);
    socket.on('close', () => this.raw.delete(socket));
    const accept = createHash('sha1')
      .update(String(req.headers['sec-websocket-key']) + GUID)
      .digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    const fake = new FakeSocket(socket, (from, message) => this.handle(from, message));
    socket.on('close', () => this.sockets.delete(fake));
    fake.send({ type: 'auth_required', ha_version: '2026.11.0.dev0' });
  }

  private result(socket: FakeSocket, id: unknown, result: unknown = null) {
    socket.send({ id, type: 'result', success: true, result });
  }

  private error(socket: FakeSocket, id: unknown, code: string, message: string) {
    socket.send({ id, type: 'result', success: false, error: { code, message } });
  }

  private handle(socket: FakeSocket, message: Record<string, unknown>) {
    if (!socket.authed) {
      if (message.type === 'auth' && this.tokens.has(String(message.access_token))) {
        socket.authed = true;
        this.sockets.add(socket);
        socket.send({ type: 'auth_ok', ha_version: '2026.11.0.dev0' });
      } else {
        socket.send({ type: 'auth_invalid', message: 'Invalid access token or password' });
        socket.destroy();
      }
      return;
    }
    const { id } = message;
    switch (message.type) {
      case 'supported_features':
        return this.result(socket, id);
      case 'ping':
        return socket.send({ id, type: 'pong' });
      case 'get_config':
        return this.result(socket, id, { version: '2026.11.0.dev0' });
      case 'auth/long_lived_access_token': {
        const token = `llat-${randomBytes(12).toString('hex')}`;
        this.tokens.add(token);
        return this.result(socket, id, token);
      }
      case 'application_credentials/create':
        return this.result(socket, id, { id: String(message.domain) });
      case 'config/area_registry/list':
        return this.result(socket, id, this.setup.areas.map((area) => ({ icon: null, ...area })));
      case 'config/device_registry/list':
        return this.result(
          socket,
          id,
          this.setup.devices.map((device) => ({
            name_by_user: null,
            manufacturer: null,
            model: null,
            area_id: null,
            config_entry_id: null,
            disabled_by: null,
            entry_type: null,
            ...device,
          })),
        );
      case 'config/entity_registry/list':
        return this.result(
          socket,
          id,
          this.setup.entities.map((entity) => ({
            area_id: null,
            platform: 'demo',
            name: null,
            original_name: null,
            entity_category: null,
            disabled_by: null,
            hidden_by: null,
            config_entry_id: null,
            ...entity,
          })),
        );
      case 'subscribe_entities': {
        socket.subscriptions.set(Number(id), 'entities');
        this.result(socket, id);
        const all = Object.fromEntries(
          Object.entries(this.states).map(([entityId, state]) => [entityId, { s: state.s, a: state.a, c: 'ctx', lc: state.lc }]),
        );
        return socket.send({ id, type: 'event', event: { a: all } });
      }
      case 'subscribe_events':
        socket.subscriptions.set(Number(id), String(message.event_type));
        return this.result(socket, id);
      case 'call_service':
        return this.callService(socket, message);
      case 'config/device_registry/update': {
        const device = this.setup.devices.find((entry) => entry.id === message.device_id);
        if (!device) return this.error(socket, id, 'not_found', 'Device not found');
        if ('name_by_user' in message) device.name_by_user = message.name_by_user as string | null;
        if ('area_id' in message) device.area_id = message.area_id as string | null;
        this.result(socket, id, device);
        return this.fire('device_registry_updated', { action: 'update', device_id: device.id });
      }
      case 'config/entity_registry/update': {
        const entity = this.setup.entities.find((entry) => entry.entity_id === message.entity_id);
        if (!entity) return this.error(socket, id, 'not_found', 'Entity not found');
        if ('name' in message) entity.name = message.name as string | null;
        if ('area_id' in message) entity.area_id = message.area_id as string | null;
        this.result(socket, id, { entity_entry: entity });
        return this.fire('entity_registry_updated', { action: 'update', entity_id: entity.entity_id });
      }
      case 'config/area_registry/create': {
        const name = String(message.name);
        if (this.setup.areas.some((area) => area.name === name)) {
          return this.error(socket, id, 'invalid_info', 'The name is already in use');
        }
        const area = { area_id: name.toLowerCase().replace(/\W+/g, '_'), name, icon: null };
        this.setup.areas.push(area);
        this.result(socket, id, area);
        return this.fire('area_registry_updated', { action: 'create', area_id: area.area_id });
      }
      default:
        return this.error(socket, id, 'unknown_command', `Unknown command ${String(message.type)}.`);
    }
  }

  private callService(socket: FakeSocket, message: Record<string, unknown>) {
    const domain = String(message.domain);
    const service = String(message.service);
    const entityId = String((message.target as { entity_id: string }).entity_id);
    const data = (message.service_data ?? {}) as Record<string, unknown>;
    this.calls.push({ domain, service, entityId, data });
    if (this.failing.has(entityId)) {
      return this.error(socket, message.id, 'home_assistant_error', 'The device did not respond.');
    }
    this.result(socket, message.id, { context: { id: 'ctx' } });
    if (!this.reportBack) return;
    const current = this.states[entityId];
    if (service === 'turn_on') {
      const attrs: Record<string, unknown> = {};
      if (typeof data.brightness_pct === 'number') attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
      if (typeof data.color_temp_kelvin === 'number') attrs.color_temp_kelvin = data.color_temp_kelvin;
      setTimeout(() => this.setState(entityId, 'on', attrs), 20);
    } else if (service === 'turn_off') {
      setTimeout(() => this.setState(entityId, 'off'), 20);
    } else if (service === 'set_temperature') {
      setTimeout(() => this.setState(entityId, current.s, { temperature: data.temperature }), 20);
    } else if (service === 'lock' || service === 'unlock') {
      setTimeout(() => this.setState(entityId, service === 'lock' ? 'locked' : 'unlocked'), 20);
    }
  }

  private async rest(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/onboarding' && req.method === 'GET') {
      return json(200, [{ step: 'user', done: this.onboarded }, { step: 'core_config', done: false }]);
    }
    if (req.url === '/api/onboarding/users' && req.method === 'POST') {
      if (this.onboarded) return json(403, { message: 'User step already done' });
      const body = JSON.parse(text) as { username?: string; password?: string; client_id?: string };
      if (!body.username || !body.password || !body.client_id) return json(400, { message: 'bad request' });
      this.onboarded = true;
      return json(200, { auth_code: 'onboarding-code' });
    }
    if (req.url === '/auth/token' && req.method === 'POST') {
      const form = new URLSearchParams(text);
      if (form.get('grant_type') !== 'authorization_code' || form.get('code') !== 'onboarding-code') {
        return json(400, { error: 'invalid_request' });
      }
      const token = `access-${randomBytes(8).toString('hex')}`;
      this.tokens.add(token);
      return json(200, { access_token: token, token_type: 'Bearer', refresh_token: 'refresh', expires_in: 1800 });
    }
    return json(404, { message: 'Not found' });
  }
}

/** A small home: a dimmable light, a plug, an AC, a lock, a sensor, plus things the app must not show. */
export function demoHome(prefix = ''): FakeSetup {
  return {
    areas: [
      { area_id: 'living_room', name: 'Living Room' },
      { area_id: 'bedroom', name: 'Bedroom' },
    ],
    devices: [
      { id: `${prefix}dev-light`, name: 'Ceiling Light', manufacturer: 'Tuya', area_id: 'living_room', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-plug`, name: 'Smart Plug', area_id: 'bedroom', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-ac`, name: 'Bedroom AC', area_id: 'bedroom', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-lock`, name: 'Front Door', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-sensor`, name: 'Climate Sensor', area_id: 'living_room', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-service`, name: 'Forecast', entry_type: 'service' },
    ],
    entities: [
      { entity_id: `light.${prefix}ceiling`, device_id: `${prefix}dev-light`, original_name: null, platform: 'tuya' },
      { entity_id: `switch.${prefix}plug`, device_id: `${prefix}dev-plug`, platform: 'tuya' },
      { entity_id: `switch.${prefix}plug_child_lock`, device_id: `${prefix}dev-plug`, entity_category: 'config', platform: 'tuya' },
      { entity_id: `sensor.${prefix}plug_power`, device_id: `${prefix}dev-plug`, original_name: 'Power', platform: 'tuya' },
      { entity_id: `climate.${prefix}ac`, device_id: `${prefix}dev-ac`, platform: 'tuya' },
      { entity_id: `lock.${prefix}front`, device_id: `${prefix}dev-lock`, platform: 'tuya' },
      { entity_id: `sensor.${prefix}temperature`, device_id: `${prefix}dev-sensor`, original_name: 'Temperature', platform: 'tuya' },
      { entity_id: `button.${prefix}restart`, device_id: `${prefix}dev-sensor`, entity_category: 'diagnostic', platform: 'tuya' },
      { entity_id: `weather.${prefix}home`, device_id: `${prefix}dev-service`, platform: 'met' },
      { entity_id: `switch.${prefix}hidden`, device_id: null, hidden_by: 'user', platform: 'template' },
      { entity_id: `input_boolean.${prefix}guest_mode`, device_id: null, name: 'Guest mode', area_id: 'living_room', platform: 'input_boolean' },
    ],
    states: {
      [`light.${prefix}ceiling`]: {
        s: 'off',
        a: { friendly_name: 'Ceiling Light', supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 },
      },
      [`switch.${prefix}plug`]: { s: 'off', a: { friendly_name: 'Smart Plug', device_class: 'outlet' } },
      [`switch.${prefix}plug_child_lock`]: { s: 'off' },
      [`sensor.${prefix}plug_power`]: { s: '0', a: { unit_of_measurement: 'W', device_class: 'power' } },
      [`climate.${prefix}ac`]: {
        s: 'cool',
        a: { supported_features: 1 | 8, current_temperature: 26, temperature: 24, min_temp: 16, max_temp: 30, target_temp_step: 1, hvac_modes: ['off', 'cool', 'heat'], fan_modes: ['low', 'high'], fan_mode: 'low' },
      },
      [`lock.${prefix}front`]: { s: 'locked' },
      [`sensor.${prefix}temperature`]: { s: '22.5', a: { unit_of_measurement: '°C', device_class: 'temperature' } },
      [`button.${prefix}restart`]: { s: 'unknown' },
      [`weather.${prefix}home`]: { s: 'sunny' },
      [`switch.${prefix}hidden`]: { s: 'on' },
      [`input_boolean.${prefix}guest_mode`]: { s: 'off' },
    },
  };
}
