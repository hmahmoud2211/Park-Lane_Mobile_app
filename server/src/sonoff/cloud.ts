import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { isIPv4, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { ApiError } from '../errors.ts';
import { send } from '../http.ts';
import { log } from '../log.ts';

/**
 * SONOFF plugs that keep their connection with this backend instead of
 * eWeLink's cloud, so they can be switched from any network without the
 * eWeLink app or an eWeLink account. While pairing, the app gives the plug
 * this server as `serverName` and `port` (POST http://10.10.7.1/ap). The plug then:
 *
 * 1. asks `POST https://<serverName>:<port>/dispatch/device` where to connect, and is told this port;
 * 2. opens a WebSocket at `/api/ws` there and sends `register`, then `date`, `update` (its state)
 *    and `query`, each answered with `error: 0`, and pings to keep the socket open;
 * 3. takes `{ action: 'update', params: { switch } }` from us and acknowledges it under the same
 *    `sequence`.
 *
 * ITEAD does not document this exchange. It follows SonOTA (https://github.com/mirko/SonOTA),
 * which answered plugs the same way; newer firmware may differ, so every step is logged.
 */

export interface CloudPlug {
  deviceId: string;
  model: string | null;
  romVersion: string | null;
  online: boolean;
  power: 'on' | 'off' | 'unknown';
  lastSeen: string;
}

export interface SonoffCloudOptions {
  port: number;
  /** What `/dispatch/device` answers with: an IPv4 address, or a name resolved to one. */
  host: string;
  /** PEM certificate and key; null serves plain HTTP (tests). */
  tls: { cert: string; key: string } | null;
  idleTimeoutMs: number;
  commandTimeoutMs: number;
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEVICE_ID = /^[0-9a-f]{10}$/i;
const MAX_FRAME = 16_384;
/** What the plug is told at register: ping every 145 s (eWeLink's own value, as SonOTA sends it). */
const HEARTBEAT = { hb: 1, hbInterval: 145 };

const plugs = new Map<string, CloudPlug>();
const connections = new Map<string, PlugConnection>();
/** `change` (deviceId) when a plug's state or availability may have changed. */
export const plugEvents = new EventEmitter();
plugEvents.setMaxListeners(0);

let options: SonoffCloudOptions | null = null;
let server: Server | null = null;

export const isConfigured = () => options !== null;
export const listPlugs = (): CloudPlug[] => [...plugs.values()].map((plug) => ({ ...plug }));
export const getPlug = (deviceId: string): CloudPlug | null => {
  const plug = plugs.get(deviceId.toLowerCase());
  return plug ? { ...plug } : null;
};

/** What the app gives a plug while pairing; null until configured. */
export function pairingServer(): { serverName: string; port: number } | null {
  return options ? { serverName: options.host, port: options.port } : null;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header =
    length < 126 ? Buffer.from([0x80 | opcode, length]) : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]);
  return Buffer.concat([header, payload]);
}

interface Pending {
  resolve: () => void;
  reject: (error: ApiError) => void;
  timer: NodeJS.Timeout;
}

class PlugConnection {
  deviceId: string | null = null;
  private apikey = '';
  private buffer = Buffer.alloc(0);
  private closed = false;
  private checked = false;
  private readonly pending = new Map<string, Pending>();
  private readonly socket: Duplex;
  private readonly from: string;

  constructor(socket: Duplex, from: string) {
    this.socket = socket;
    this.from = from;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => this.cleanup());
    socket.on('error', () => this.cleanup());
  }

  private write(data: Buffer) {
    if (!this.closed && this.socket.writable) {
      this.socket.write(data);
    }
  }

  private reply(message: Record<string, unknown>) {
    this.write(frame(0x1, Buffer.from(JSON.stringify({ error: 0, deviceid: this.deviceId, apikey: this.apikey, ...message }))));
  }

  close() {
    if (!this.closed) {
      this.write(frame(0x8, Buffer.alloc(0)));
      this.socket.end();
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [sequence, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ApiError('device_offline', 'The plug disconnected before confirming.'));
      this.pending.delete(sequence);
    }
    const id = this.deviceId;
    if (id && connections.get(id) === this) {
      connections.delete(id);
      const plug = plugs.get(id);
      if (plug) {
        plug.online = false;
        plugEvents.emit('change', id);
      }
      log.info('SONOFF plug disconnected', { deviceId: id });
    }
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127 || length > MAX_FRAME || (first & 0x80) === 0) {
        log.warn('SONOFF plug sent a frame this server does not take', { deviceId: this.deviceId, opcode, length });
        this.close();
        return;
      }
      // Clients must mask; tolerate firmware that does not.
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) {
        return;
      }
      const payload = Buffer.from(this.buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      this.buffer = this.buffer.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        this.write(frame(0xa, payload));
      } else if (opcode === 0x1) {
        this.handle(payload.toString('utf8'));
      }
    }
  }

  private handle(text: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      log.warn('SONOFF plug sent something other than JSON', { deviceId: this.deviceId });
      return;
    }
    const action = typeof message.action === 'string' ? message.action : null;
    const sequence = typeof message.sequence === 'string' ? message.sequence : null;

    // The plug's answer to one of our commands.
    if (!action && sequence !== null && 'error' in message) {
      const pending = this.pending.get(sequence);
      if (pending) {
        this.pending.delete(sequence);
        clearTimeout(pending.timer);
        if (message.error === 0) {
          pending.resolve();
        } else {
          pending.reject(new ApiError('device_unreachable', `The plug refused the command (error ${String(message.error)}).`));
        }
      }
      return;
    }

    if (action === 'register') {
      this.register(message);
      return;
    }
    if (!this.deviceId) {
      log.warn('SONOFF plug spoke before registering', { action, from: this.from });
      this.close();
      return;
    }
    const plug = plugs.get(this.deviceId);
    if (plug) {
      plug.lastSeen = new Date().toISOString();
    }

    switch (action) {
      case 'date':
        this.reply({ date: new Date().toISOString() });
        return;
      case 'update': {
        const params = (message.params ?? {}) as Record<string, unknown>;
        if (plug && (params.switch === 'on' || params.switch === 'off') && plug.power !== params.switch) {
          plug.power = params.switch;
          plugEvents.emit('change', this.deviceId);
        }
        this.reply({});
        if (plug && plug.power !== 'unknown') {
          this.checkCommands(plug.power);
        }
        return;
      }
      case 'query':
        this.reply({ params: 0 });
        return;
      default:
        log.info('SONOFF plug sent an action this server only acknowledges', { deviceId: this.deviceId, action });
        this.reply({});
    }
  }

  private register(message: Record<string, unknown>) {
    const deviceId = typeof message.deviceid === 'string' ? message.deviceid.toLowerCase() : '';
    if (!DEVICE_ID.test(deviceId)) {
      log.warn('SONOFF plug registered without a valid device id', { from: this.from });
      this.close();
      return;
    }
    this.deviceId = deviceId;
    this.apikey = typeof message.apikey === 'string' ? message.apikey : '';
    connections.get(deviceId)?.close();
    connections.set(deviceId, this);
    const previous = plugs.get(deviceId);
    plugs.set(deviceId, {
      deviceId,
      model: typeof message.model === 'string' ? message.model : (previous?.model ?? null),
      romVersion: typeof message.romVersion === 'string' ? message.romVersion : (previous?.romVersion ?? null),
      online: true,
      power: previous?.power ?? 'unknown',
      lastSeen: new Date().toISOString(),
    });
    this.reply({ config: HEARTBEAT });
    plugEvents.emit('change', deviceId);
    log.info('SONOFF plug connected', { deviceId, model: message.model, romVersion: message.romVersion, from: this.from });
  }

  /** Once per connection: re-send the state the plug reported, which changes nothing, to prove commands reach it. */
  private checkCommands(power: 'on' | 'off') {
    if (this.checked) {
      return;
    }
    this.checked = true;
    this.command(power).then(
      () => log.info('SONOFF plug confirmed a command; it can be switched', { deviceId: this.deviceId }),
      (error: unknown) =>
        log.warn('SONOFF plug did not confirm a command', {
          deviceId: this.deviceId,
          reason: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  command(power: 'on' | 'off'): Promise<void> {
    if (this.closed || !this.deviceId || !options) {
      return Promise.reject(new ApiError('device_offline', 'The plug is not connected.'));
    }
    const sequence = String(Date.now() + this.pending.size);
    const timeoutMs = options.commandTimeoutMs;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new ApiError('command_timeout', 'The plug did not confirm in time.'));
      }, timeoutMs);
      this.pending.set(sequence, { resolve, reject, timer });
      this.write(
        frame(
          0x1,
          Buffer.from(
            JSON.stringify({
              action: 'update',
              deviceid: this.deviceId,
              apikey: this.apikey,
              userAgent: 'app',
              sequence,
              ts: 0,
              params: { switch: power },
              from: 'app',
            }),
          ),
        ),
      );
    });
  }
}

/** Switches a connected plug; resolves once the plug acknowledged. */
export async function setPlugPower(deviceId: string, power: 'on' | 'off'): Promise<void> {
  const id = deviceId.toLowerCase();
  const connection = connections.get(id);
  if (!connection) {
    throw new ApiError('device_offline', 'The plug is not connected to this server.');
  }
  await connection.command(power);
  const plug = plugs.get(id);
  if (plug && plug.power !== power) {
    plug.power = power;
    plugEvents.emit('change', id);
  }
}

async function publicAddress(host: string): Promise<string> {
  return isIPv4(host) ? host : (await lookup(host, { family: 4 })).address;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > 4096) {
      break;
    }
  }
  return text;
}

async function dispatch(req: IncomingMessage, res: ServerResponse, from: string) {
  let asked: Record<string, unknown> = {};
  try {
    asked = JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    // The answer is the same either way; the fields are only logged.
  }
  log.info('SONOFF plug asked where to connect', {
    deviceId: asked.deviceid,
    model: asked.model,
    romVersion: asked.romVersion,
    accept: asked.accept,
    from,
  });
  const { host, port } = options!;
  try {
    send(res, 200, { error: 0, reason: 'ok', IP: await publicAddress(host), port });
  } catch {
    log.error('SONOFF_CLOUD_HOST does not resolve to an IPv4 address', { host });
    send(res, 200, { error: 500, reason: 'unavailable' });
  }
}

function accept(req: IncomingMessage, socket: Duplex) {
  const from = req.socket.remoteAddress ?? 'unknown';
  const path = new URL(req.url ?? '/', 'http://plug').pathname;
  const key = req.headers['sec-websocket-key'];
  if (path !== '/api/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') {
    log.warn('SONOFF plug socket refused', { path, from });
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const acceptKey = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`, '', ''].join(
      '\r\n',
    ),
  );
  // An upgraded request's socket is the TCP (or TLS) socket itself.
  (socket as Socket).setTimeout(options!.idleTimeoutMs, () => socket.destroy());
  new PlugConnection(socket, from);
}

/** Starts the plugs' server; resolves once it listens. */
export function startSonoffCloud(settings: SonoffCloudOptions): Promise<void> {
  options = settings;
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const from = req.socket.remoteAddress ?? 'unknown';
    const path = new URL(req.url ?? '/', 'http://plug').pathname;
    if (req.method === 'POST' && path === '/dispatch/device') {
      void dispatch(req, res, from);
      return;
    }
    log.info('SONOFF server request it does not serve', { method: req.method, path, from });
    send(res, 404, { error: 404, reason: 'not found' });
  };
  server = settings.tls
    ? createHttpsServer(
        {
          ...settings.tls,
          // Plug firmware speaks old TLS; nothing here is secret beyond the switch state.
          minVersion: 'TLSv1',
          ciphers: 'DEFAULT:@SECLEVEL=0',
        },
        handler,
      )
    : createHttpServer(handler);
  server.on('upgrade', accept);
  server.on('tlsClientError', (error: NodeJS.ErrnoException, socket: { remoteAddress?: string }) =>
    log.warn('SONOFF plug TLS handshake failed', { reason: error.code ?? error.message, from: socket.remoteAddress }),
  );
  return new Promise((resolve) => server!.listen(settings.port, '0.0.0.0', () => resolve()));
}

export function stopSonoffCloud(): Promise<void> {
  for (const connection of connections.values()) {
    connection.close();
  }
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

/** The server as configured in .env, when SONOFF_CLOUD_PORT is set. */
export function sonoffCloudOptionsFrom(settings: {
  port: number;
  host: string;
  certFile: string;
  keyFile: string;
  idleTimeoutMs: number;
  commandTimeoutMs: number;
}): SonoffCloudOptions | null {
  if (!settings.port || !settings.host) {
    return null;
  }
  const tls =
    settings.certFile && settings.keyFile
      ? { cert: readFileSync(settings.certFile, 'utf8'), key: readFileSync(settings.keyFile, 'utf8') }
      : null;
  return { port: settings.port, host: settings.host, tls, idleTimeoutMs: settings.idleTimeoutMs, commandTimeoutMs: settings.commandTimeoutMs };
}
