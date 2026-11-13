import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * A stand-in for one Home Assistant instance: its WebSocket API (auth,
 * registries, subscribe_entities, subscribe_events, call_service and the
 * registry updates the facade uses), the onboarding REST calls the
 * provisioner makes, and config flows for three scripted brands:
 * switchbot_cloud and sonoff (a form), tuya (a form, then a QR code) and smartthings
 * (OAuth through an external step and /auth/external/callback). State lives in memory and changes the way HA reports
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

export interface FakeEntry {
  entry_id: string;
  domain: string;
  title: string;
  state: string;
  disabled_by: string | null;
  reason: string | null;
}

interface FakeFlow {
  flow_id: string;
  handler: string;
  step: string;
  context: { source: string; entry_id?: string };
  externalDone?: boolean;
}

/** What frontend/get_translations answers for the scripted brands. */
const TRANSLATIONS: Record<string, string> = {
  'component.switchbot_cloud.config.step.user.title': 'Connect SwitchBot',
  'component.switchbot_cloud.config.step.user.data.api_token': 'Token',
  'component.switchbot_cloud.config.step.user.data.api_key': 'Secret',
  'component.switchbot_cloud.config.error.invalid_auth': 'Invalid authentication',
  'component.sonoff.config.step.user.data.username': 'Username',
  'component.sonoff.config.step.user.data.password': 'Password',
  'component.sonoff.config.step.user.data.country_code': 'Country code',
  'component.sonoff.config.error.exception': 'Wrong username or password',
  'component.tuya.config.step.user.data.user_code': 'User code',
  'component.tuya.config.step.scan.description': 'Scan this code with the {app} app.',
  'component.smartthings.config.abort.already_configured': 'Account is already configured',
};

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
  /** Accounts whose reload fails, as when the brand's cloud is down. */
  readonly failingReloads = new Set<string>();
  /** When false, service calls succeed but the device never reports back. */
  reportBack = true;
  /** The code a demo alarm panel takes (it refuses others, as Home Assistant does). */
  alarmCode = '1234';
  private track = 1;
  onboarded = false;
  private readonly sockets = new Set<FakeSocket>();
  private readonly raw = new Set<Duplex>();
  private refusing = false;
  private setup: FakeSetup;
  readonly entries: FakeEntry[] = [];
  readonly flows = new Map<string, FakeFlow>();
  /** The HA-Frontend-Base header of the last flow request, which OAuth redirects are built from. */
  lastFrontendBase: string | null = null;
  private flowCounter = 0;
  private readonly addedOnReload = new Map<string, string[]>();
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
      case 'frontend/get_translations': {
        const wanted = (message.integration as string[] | undefined) ?? [];
        const resources = Object.fromEntries(
          Object.entries(TRANSLATIONS).filter(([key]) => wanted.some((domain) => key.startsWith(`component.${domain}.`))),
        );
        return this.result(socket, id, { resources });
      }
      case 'config_entries/get':
        return this.result(socket, id, this.entries);
      case 'config_entries/flow/progress':
        return this.result(
          socket,
          id,
          [...this.flows.values()]
            .filter((flow) => flow.context.source !== 'user')
            .map((flow) => ({ flow_id: flow.flow_id, handler: flow.handler, step_id: flow.step, context: flow.context })),
        );
      case 'config_entries/subscribe':
        socket.subscriptions.set(Number(id), 'entries');
        this.result(socket, id);
        return socket.send({ id, type: 'event', event: this.entries.map((entry) => ({ type: null, entry })) });
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
    const current = this.states[entityId];
    if (domain === 'alarm_control_panel' && typeof current?.a.code_format === 'string') {
      const wanted = service === 'alarm_disarm' || current.a.code_arm_required !== false;
      if (wanted && data.code !== this.alarmCode) {
        return this.error(socket, message.id, 'service_validation_error', 'Invalid alarm code provided');
      }
    }
    this.result(socket, message.id, { context: { id: 'ctx' } });
    if (!this.reportBack) return;
    const next = this.simulate(domain, service, data, current);
    if (next) {
      setTimeout(() => this.setState(entityId, next.s, next.a), 20);
    }
  }

  /** The state a device reports after a service call, roughly as the real integration would; null when nothing changes. */
  private simulate(domain: string, service: string, data: Record<string, unknown>, current: { s: string; a: Record<string, unknown> } | undefined) {
    const s = current?.s ?? 'unknown';
    const a = current?.a ?? {};
    const same = (attrs: Record<string, unknown>) => ({ s, a: attrs });
    const position = (value: unknown) => (typeof value === 'number' ? value : 0);
    switch (service) {
      case 'turn_on': {
        const attrs: Record<string, unknown> = {};
        if (typeof data.brightness_pct === 'number') attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
        if (typeof data.color_temp_kelvin === 'number') attrs.color_temp_kelvin = data.color_temp_kelvin;
        if (Array.isArray(data.hs_color)) attrs.hs_color = data.hs_color;
        if (typeof data.effect === 'string') attrs.effect = data.effect;
        if (typeof data.activity === 'string') attrs.current_activity = data.activity;
        const modes = Array.isArray(a.operation_list) ? (a.operation_list as string[]) : [];
        return { s: domain === 'water_heater' ? (modes.find((mode) => mode !== 'off') ?? 'eco') : 'on', a: attrs };
      }
      case 'turn_off':
        return { s: 'off', a: {} };
      case 'toggle':
        return { s: s === 'on' ? 'off' : 'on', a: {} };
      case 'set_temperature': {
        const attrs: Record<string, unknown> = {};
        for (const key of ['temperature', 'target_temp_low', 'target_temp_high']) if (typeof data[key] === 'number') attrs[key] = data[key];
        return same(attrs);
      }
      case 'set_hvac_mode':
        return { s: String(data.hvac_mode), a: {} };
      case 'set_fan_mode':
        return same({ fan_mode: data.fan_mode });
      case 'set_preset_mode':
        return same({ preset_mode: data.preset_mode });
      case 'set_swing_mode':
        return same({ swing_mode: data.swing_mode });
      case 'set_humidity':
        return same({ humidity: data.humidity });
      case 'set_mode':
        return same({ mode: data.mode });
      case 'open_cover':
      case 'close_cover':
        return { s: service === 'open_cover' ? 'open' : 'closed', a: { current_position: service === 'open_cover' ? 100 : 0 } };
      case 'set_cover_position':
        return { s: position(data.position) > 0 ? 'open' : 'closed', a: { current_position: data.position } };
      case 'open_cover_tilt':
      case 'close_cover_tilt':
        return same({ current_tilt_position: service === 'open_cover_tilt' ? 100 : 0 });
      case 'set_cover_tilt_position':
        return same({ current_tilt_position: data.tilt_position });
      case 'lock':
        return { s: 'locked', a: {} };
      case 'unlock':
        return { s: 'unlocked', a: {} };
      case 'open':
        return { s: 'open', a: {} };
      case 'set_percentage':
        return { s: position(data.percentage) > 0 ? 'on' : 'off', a: { percentage: data.percentage } };
      case 'oscillate':
        return same({ oscillating: data.oscillating });
      case 'set_direction':
        return same({ direction: data.direction });
      case 'media_play':
        return { s: 'playing', a: {} };
      case 'media_pause':
        return { s: 'paused', a: {} };
      case 'media_play_pause':
        return { s: s === 'playing' ? 'paused' : 'playing', a: {} };
      case 'media_stop':
        return { s: 'idle', a: {} };
      case 'media_next_track':
      case 'media_previous_track':
        return same({ media_title: `Episode ${(this.track += service === 'media_next_track' ? 1 : -1)}` });
      case 'volume_set':
        return same({ volume_level: data.volume_level });
      case 'volume_up':
      case 'volume_down': {
        const level = typeof a.volume_level === 'number' ? a.volume_level : 0;
        return same({ volume_level: Math.round(Math.min(1, Math.max(0, level + (service === 'volume_up' ? 0.1 : -0.1))) * 100) / 100 });
      }
      case 'volume_mute':
        return same({ is_volume_muted: data.is_volume_muted });
      case 'select_source':
        return same({ source: data.source });
      case 'select_sound_mode':
        return same({ sound_mode: data.sound_mode });
      case 'shuffle_set':
        return same({ shuffle: data.shuffle });
      case 'repeat_set':
        return same({ repeat: data.repeat });
      case 'select_option':
        return { s: String(data.option), a: {} };
      case 'set_value':
        return { s: String(data.value), a: {} };
      case 'press':
        return { s: new Date().toISOString(), a: {} };
      case 'start':
      case 'clean_spot':
        return { s: 'cleaning', a: {} };
      case 'start_mowing':
        return { s: 'mowing', a: {} };
      case 'pause':
        return { s: 'paused', a: {} };
      case 'stop':
        return { s: 'idle', a: {} };
      case 'return_to_base':
      case 'dock':
        return { s: 'returning', a: {} };
      case 'set_fan_speed':
        return same({ fan_speed: data.fan_speed });
      case 'set_operation_mode':
        return { s: String(data.operation_mode), a: { operation_mode: data.operation_mode } };
      case 'set_away_mode':
        return same({ away_mode: data.away_mode ? 'on' : 'off' });
      case 'open_valve':
      case 'close_valve':
        return { s: service === 'open_valve' ? 'open' : 'closed', a: { current_position: service === 'open_valve' ? 100 : 0 } };
      case 'set_valve_position':
        return { s: position(data.position) > 0 ? 'open' : 'closed', a: { current_position: data.position } };
      case 'alarm_disarm':
        return { s: 'disarmed', a: {} };
      default:
        // alarm_arm_home → armed_home, and so on; anything else (locate, stop_cover…) changes nothing visible.
        return service.startsWith('alarm_arm_') ? { s: `armed_${service.slice('alarm_arm_'.length)}`, a: {} } : null;
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
    if (req.url?.startsWith('/auth/external/callback') && req.method === 'GET') {
      const query = new URL(req.url, 'http://ha').searchParams;
      const state = this.decodeState(query.get('state') ?? '');
      const flow = state ? this.flows.get(state.flow_id) : undefined;
      if (!flow || !query.get('code')) return json(400, { message: 'Invalid state' });
      flow.externalDone = true;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<script>window.close()</script>');
    }
    if (req.url?.startsWith('/api/config/')) {
      if (!this.tokens.has(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))) return json(401, { message: 'Unauthorized' });
      this.lastFrontendBase = (req.headers['ha-frontend-base'] as string | undefined) ?? null;
      return this.configRest(req.method ?? 'GET', new URL(req.url, 'http://ha').pathname, text ? JSON.parse(text) : {}, json);
    }
    return json(404, { message: 'Not found' });
  }

  /** Adds a linked account, as a finished flow or a test's setup does, and tells subscribers. */
  addEntry(domain: string, title: string, state = 'loaded'): FakeEntry {
    const entry: FakeEntry = { entry_id: `entry-${domain}-${this.entries.length + 1}`, domain, title, state, disabled_by: null, reason: null };
    this.entries.push(entry);
    this.fireEntries('added', entry);
    return entry;
  }

  /** A flow HA started itself, e.g. a brand asking the resident to sign in again. */
  startReauth(entry: FakeEntry): string {
    const flow: FakeFlow = { flow_id: `flow-${++this.flowCounter}`, handler: entry.domain, step: 'reauth_confirm', context: { source: 'reauth', entry_id: entry.entry_id } };
    this.flows.set(flow.flow_id, flow);
    return flow.flow_id;
  }

  private fireEntries(type: string, entry: FakeEntry) {
    for (const socket of this.sockets) {
      for (const [id, kind] of socket.subscriptions) {
        if (kind === 'entries') socket.send({ id, type: 'event', event: [{ type, entry }] });
      }
    }
  }

  private encodeState(flowId: string): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ flow_id: flowId, redirect_uri: `${this.lastFrontendBase}/auth/external/callback` })}.signature`;
  }

  private decodeState(state: string): { flow_id: string } | null {
    try {
      const [, payload, signature] = state.split('.');
      return signature === 'signature' ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : null;
    } catch {
      return null;
    }
  }

  private stepResult(flow: FakeFlow, errors: Record<string, string> | null = null): Record<string, unknown> {
    const base = { flow_id: flow.flow_id, handler: flow.handler, step_id: flow.step, errors, description_placeholders: null };
    switch (`${flow.handler}:${flow.step}`) {
      case 'switchbot_cloud:user':
        return {
          ...base,
          type: 'form',
          data_schema: [
            { name: 'api_token', required: true, type: 'string' },
            { name: 'api_key', required: true, selector: { text: { type: 'password' } } },
          ],
        };
      case 'sonoff:user':
        // The form SonoffLAN's config flow serialises to: the password and country are optional there.
        return {
          ...base,
          type: 'form',
          data_schema: [
            { name: 'username', required: true, type: 'string' },
            { name: 'password', optional: true, type: 'string' },
            { name: 'country_code', optional: true, type: 'select', options: [['+20', 'Egypt | +20'], ['+971', 'United Arab Emirates | +971']] },
          ],
        };
      case 'tuya:user':
        return { ...base, type: 'form', data_schema: [{ name: 'user_code', required: true, type: 'string' }] };
      case 'tuya:scan':
        return {
          ...base,
          type: 'form',
          description_placeholders: { app: 'Smart Life' },
          data_schema: [{ name: 'QR', optional: true, selector: { qr_code: { data: 'tuyaSmart--qrLogin?token=abc123', scale: 5 } } }],
        };
      case 'smartthings:auth':
        return flow.externalDone
          ? { ...base, type: 'external_done' }
          : { ...base, type: 'external', url: `https://api.smartthings.com/oauth/authorize?redirect_uri=${encodeURIComponent(`${this.lastFrontendBase}/auth/external/callback`)}&state=${this.encodeState(flow.flow_id)}` };
      default:
        return { ...base, type: 'form', data_schema: [] };
    }
  }

  /** A plug the brand registers for an account, with HA's registry events and its first state. */
  private registerDevice(entry: FakeEntry, name: string, key: string) {
    const deviceId = `dev-${key}`;
    const entityId = `switch.${key.replace(/\W/g, '_')}`;
    this.setup.devices.push({ id: deviceId, name, manufacturer: entry.title, config_entry_id: entry.entry_id });
    this.setup.entities.push({ entity_id: entityId, device_id: deviceId, platform: entry.domain, config_entry_id: entry.entry_id });
    this.fire('device_registry_updated', { action: 'create', device_id: deviceId });
    this.fire('entity_registry_updated', { action: 'create', entity_id: entityId });
    this.setState(entityId, 'off', { device_class: 'outlet' });
  }

  /** A device added in the brand's own app: HA only learns of it when the account reloads. */
  addDeviceOnReload(entry: FakeEntry, name: string) {
    this.addedOnReload.set(entry.entry_id, [...(this.addedOnReload.get(entry.entry_id) ?? []), name]);
  }

  /** A linked account brings its devices in, as a real brand's integration does once set up. */
  private finish(flow: FakeFlow, title: string) {
    this.flows.delete(flow.flow_id);
    const entry = this.addEntry(flow.handler, title);
    this.registerDevice(entry, `${title} Plug`, entry.entry_id);
    return { flow_id: flow.flow_id, handler: flow.handler, type: 'create_entry', title, result: { entry_id: entry.entry_id } };
  }

  private configRest(method: string, path: string, body: Record<string, unknown>, json: (status: number, body: unknown) => void) {
    if (path === '/api/config/config_entries/flow' && method === 'POST') {
      const handler = String(body.handler);
      if (!['switchbot_cloud', 'sonoff', 'tuya', 'smartthings'].includes(handler)) return json(404, { message: 'Invalid handler specified' });
      const flow: FakeFlow = { flow_id: `flow-${++this.flowCounter}`, handler, step: handler === 'smartthings' ? 'auth' : 'user', context: { source: 'user' } };
      this.flows.set(flow.flow_id, flow);
      return json(200, this.stepResult(flow));
    }
    const flowMatch = /^\/api\/config\/config_entries\/flow\/([^/]+)$/.exec(path);
    if (flowMatch) {
      const flow = this.flows.get(flowMatch[1]);
      if (!flow) return json(404, { message: 'Flow not found' });
      if (method === 'GET') return json(200, this.stepResult(flow));
      if (method === 'DELETE') {
        this.flows.delete(flow.flow_id);
        return json(200, { message: 'Flow aborted' });
      }
      switch (`${flow.handler}:${flow.step}`) {
        case 'switchbot_cloud:user':
          if (body.api_token === undefined) return json(400, { message: "User input malformed: required key not provided @ data['api_token']" });
          if (body.api_token === 'bad') return json(200, this.stepResult(flow, { base: 'invalid_auth' }));
          return json(200, this.finish(flow, 'SwitchBot'));
        case 'sonoff:user':
          if (body.username === undefined) return json(400, { message: "User input malformed: required key not provided @ data['username']" });
          if (body.password === 'bad') return json(200, this.stepResult(flow, { base: 'exception' }));
          return json(200, this.finish(flow, 'eWeLink'));
        case 'tuya:user':
          flow.step = 'scan';
          return json(200, this.stepResult(flow));
        case 'tuya:scan':
          return json(200, this.finish(flow, 'Smart Life'));
        case 'smartthings:auth':
          if (!flow.externalDone) return json(200, this.stepResult(flow));
          return json(200, this.finish(flow, 'SmartThings'));
        default:
          if (flow.context.source === 'reauth') {
            this.flows.delete(flow.flow_id);
            return json(200, { flow_id: flow.flow_id, handler: flow.handler, type: 'abort', reason: 'reauth_successful' });
          }
          return json(400, { message: 'Unexpected step' });
      }
    }
    const entryMatch = /^\/api\/config\/config_entries\/entry\/([^/]+)(\/reload)?$/.exec(path);
    if (entryMatch) {
      const index = this.entries.findIndex((entry) => entry.entry_id === entryMatch[1]);
      if (index === -1) return json(404, { message: 'Entry not found' });
      if (entryMatch[2] && method === 'POST') {
        const entry = this.entries[index];
        if (this.failingReloads.has(entry.entry_id)) return json(500, { message: 'Error reloading entry' });
        (this.addedOnReload.get(entry.entry_id) ?? []).forEach((name, n) => this.registerDevice(entry, name, `${entry.entry_id}-new${n}`));
        this.addedOnReload.delete(entry.entry_id);
        return json(200, { require_restart: false });
      }
      if (!entryMatch[2] && method === 'DELETE') {
        const [entry] = this.entries.splice(index, 1);
        this.fireEntries('removed', entry);
        return json(200, { require_restart: false });
      }
    }
    return json(404, { message: 'Not found' });
  }
}

/**
 * A small home: a dimmable light, a plug, an AC with presets, swing and humidity, a lock that can unlatch, a
 * sensor, a TV, a robot vacuum, tilting blinds and an alarm panel (code 1234), plus settings (`config` entities: the
 * plug's child lock and power-on behaviour, the light's transition time) and things the app must not show.
 */
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
      { id: `${prefix}dev-tv`, name: 'Living Room TV', manufacturer: 'LG', model: 'OLED55C3', area_id: 'living_room', config_entry_id: 'entry-webostv' },
      { id: `${prefix}dev-vacuum`, name: 'Robot Vacuum', manufacturer: 'Roborock', model: 'S8', area_id: 'living_room', config_entry_id: 'entry-roborock' },
      { id: `${prefix}dev-blinds`, name: 'Bedroom Blinds', manufacturer: 'Tuya', area_id: 'bedroom', config_entry_id: 'entry-tuya' },
      { id: `${prefix}dev-alarm`, name: 'Alarm Panel', manufacturer: 'Tuya', config_entry_id: 'entry-tuya' },
    ],
    entities: [
      { entity_id: `light.${prefix}ceiling`, device_id: `${prefix}dev-light`, original_name: null, platform: 'tuya' },
      { entity_id: `number.${prefix}ceiling_transition`, device_id: `${prefix}dev-light`, original_name: 'Transition time', entity_category: 'config', platform: 'tuya' },
      { entity_id: `switch.${prefix}plug`, device_id: `${prefix}dev-plug`, platform: 'tuya' },
      { entity_id: `switch.${prefix}plug_child_lock`, device_id: `${prefix}dev-plug`, original_name: 'Child lock', entity_category: 'config', platform: 'tuya' },
      { entity_id: `select.${prefix}plug_power_on`, device_id: `${prefix}dev-plug`, original_name: 'Power-on behaviour', entity_category: 'config', platform: 'tuya' },
      { entity_id: `sensor.${prefix}plug_power`, device_id: `${prefix}dev-plug`, original_name: 'Power', platform: 'tuya' },
      { entity_id: `climate.${prefix}ac`, device_id: `${prefix}dev-ac`, platform: 'tuya' },
      { entity_id: `lock.${prefix}front`, device_id: `${prefix}dev-lock`, platform: 'tuya' },
      { entity_id: `sensor.${prefix}temperature`, device_id: `${prefix}dev-sensor`, original_name: 'Temperature', platform: 'tuya' },
      { entity_id: `button.${prefix}restart`, device_id: `${prefix}dev-sensor`, entity_category: 'diagnostic', platform: 'tuya' },
      { entity_id: `media_player.${prefix}tv`, device_id: `${prefix}dev-tv`, platform: 'webostv' },
      { entity_id: `vacuum.${prefix}robot`, device_id: `${prefix}dev-vacuum`, platform: 'roborock' },
      { entity_id: `cover.${prefix}blinds`, device_id: `${prefix}dev-blinds`, platform: 'tuya' },
      { entity_id: `alarm_control_panel.${prefix}home`, device_id: `${prefix}dev-alarm`, platform: 'tuya' },
      { entity_id: `weather.${prefix}home`, device_id: `${prefix}dev-service`, platform: 'met' },
      { entity_id: `switch.${prefix}hidden`, device_id: null, hidden_by: 'user', platform: 'template' },
      { entity_id: `input_boolean.${prefix}guest_mode`, device_id: null, name: 'Guest mode', area_id: 'living_room', platform: 'input_boolean' },
    ],
    states: {
      [`light.${prefix}ceiling`]: {
        s: 'off',
        a: { friendly_name: 'Ceiling Light', supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 6500 },
      },
      [`number.${prefix}ceiling_transition`]: { s: '1.0', a: { min: 0, max: 10, step: 0.5, mode: 'slider', unit_of_measurement: 's' } },
      [`switch.${prefix}plug`]: { s: 'off', a: { friendly_name: 'Smart Plug', device_class: 'outlet' } },
      [`switch.${prefix}plug_child_lock`]: { s: 'off' },
      [`select.${prefix}plug_power_on`]: { s: 'previous', a: { options: ['off', 'on', 'previous'] } },
      [`sensor.${prefix}plug_power`]: { s: '0', a: { unit_of_measurement: 'W', device_class: 'power' } },
      [`climate.${prefix}ac`]: {
        s: 'cool',
        a: {
          // TARGET_TEMPERATURE | TARGET_HUMIDITY | FAN_MODE | PRESET_MODE | SWING_MODE
          supported_features: 1 | 4 | 8 | 16 | 32,
          current_temperature: 26,
          temperature: 24,
          min_temp: 16,
          max_temp: 30,
          target_temp_step: 1,
          hvac_modes: ['off', 'cool', 'heat'],
          fan_modes: ['low', 'high'],
          fan_mode: 'low',
          preset_modes: ['none', 'eco', 'boost', 'sleep'],
          preset_mode: 'none',
          swing_modes: ['off', 'vertical', 'horizontal', 'both'],
          swing_mode: 'off',
          current_humidity: 55,
          humidity: 50,
          min_humidity: 30,
          max_humidity: 70,
        },
      },
      // OPEN: the lock can unlatch the door.
      [`lock.${prefix}front`]: { s: 'locked', a: { supported_features: 1 } },
      [`sensor.${prefix}temperature`]: { s: '22.5', a: { unit_of_measurement: '°C', device_class: 'temperature' } },
      [`button.${prefix}restart`]: { s: 'unknown' },
      [`media_player.${prefix}tv`]: {
        s: 'playing',
        a: {
          friendly_name: 'Living Room TV',
          device_class: 'tv',
          // Everything the contract shows: pause, volume set/mute/step, previous/next, on/off, source, stop, play,
          // shuffle, sound mode, repeat.
          supported_features: 1 | 4 | 8 | 16 | 32 | 128 | 256 | 1024 | 2048 | 4096 | 16384 | 32768 | 65536 | 262144,
          volume_level: 0.25,
          is_volume_muted: false,
          media_title: 'Episode 1',
          media_artist: 'Planet Earth III',
          source: 'Netflix',
          source_list: ['Live TV', 'HDMI 1', 'Netflix', 'YouTube'],
          sound_mode: 'Cinema',
          sound_mode_list: ['Standard', 'Cinema', 'Music'],
          shuffle: false,
          repeat: 'off',
        },
      },
      [`vacuum.${prefix}robot`]: {
        s: 'docked',
        a: {
          // PAUSE | STOP | RETURN_HOME | FAN_SPEED | BATTERY | LOCATE | CLEAN_SPOT | STATE | START
          supported_features: 4 | 8 | 16 | 32 | 64 | 512 | 1024 | 4096 | 8192,
          battery_level: 87,
          fan_speed: 'balanced',
          fan_speed_list: ['quiet', 'balanced', 'turbo', 'max'],
        },
      },
      [`cover.${prefix}blinds`]: {
        s: 'open',
        // Every cover feature: open, close, position, stop, and the slats' open/close/stop/position.
        a: { device_class: 'blind', supported_features: 255, current_position: 60, current_tilt_position: 45 },
      },
      [`alarm_control_panel.${prefix}home`]: {
        s: 'disarmed',
        // ARM_HOME | ARM_AWAY | ARM_NIGHT | ARM_VACATION; the code is needed to disarm only.
        a: { supported_features: 1 | 2 | 4 | 32, code_format: 'number', code_arm_required: false, changed_by: null },
      },
      [`weather.${prefix}home`]: { s: 'sunny' },
      [`switch.${prefix}hidden`]: { s: 'on' },
      [`input_boolean.${prefix}guest_mode`]: { s: 'off' },
    },
  };
}
