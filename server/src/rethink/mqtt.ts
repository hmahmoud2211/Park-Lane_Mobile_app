import { EventEmitter } from 'node:events';
import { connect as tcpConnect, type Socket } from 'node:net';

import { log } from '../log.ts';

/**
 * The little of MQTT 3.1.1 the rethink adapter needs, so the backend keeps no
 * dependencies: connect (optionally with a username and password), subscribe
 * and publish at QoS 0, keep-alive pings, and reconnecting with backoff.
 *
 * Events: `connect` (after the broker accepted us), `close`, and
 * `message` (topic, payload, retained).
 */

const CONNECT = 0x10;
const CONNACK = 0x20;
const PUBLISH = 0x30;
const PUBACK = 0x40;
const SUBSCRIBE = 0x82;
const SUBACK = 0x90;
const PINGREQ = 0xc0;
const PINGRESP = 0xd0;

const KEEPALIVE_S = 30;
const MAX_BACKOFF_MS = 30_000;

function str(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function packet(type: number, body: Buffer): Buffer {
  const length: number[] = [];
  let remaining = body.length;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    length.push(byte);
  } while (remaining > 0);
  return Buffer.concat([Buffer.from([type, ...length]), body]);
}

/** One packet off the front of `buffer`, or null until all of it has arrived. */
export function readPacket(buffer: Buffer): { type: number; body: Buffer; size: number } | null {
  let length = 0;
  let multiplier = 1;
  for (let index = 1; index < 5; index += 1) {
    if (index >= buffer.length) {
      return null;
    }
    const byte = buffer[index];
    length += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    if ((byte & 0x80) === 0) {
      const size = index + 1 + length;
      return buffer.length < size ? null : { type: buffer[0], body: buffer.subarray(index + 1, size), size };
    }
  }
  throw new Error('Malformed MQTT length.');
}

export function connectPacket(clientId: string, username: string, password: string): Buffer {
  const flags = 0x02 | (username ? 0x80 : 0) | (password ? 0x40 : 0);
  const keepAlive = Buffer.alloc(2);
  keepAlive.writeUInt16BE(KEEPALIVE_S);
  return packet(
    CONNECT,
    Buffer.concat([
      str('MQTT'),
      Buffer.from([4, flags]),
      keepAlive,
      str(clientId),
      ...(username ? [str(username)] : []),
      ...(password ? [str(password)] : []),
    ]),
  );
}

export function publishPacket(topic: string, payload: string, retain: boolean): Buffer {
  return packet(PUBLISH | (retain ? 0x01 : 0), Buffer.concat([str(topic), Buffer.from(payload, 'utf8')]));
}

export function parsePublish(flags: number, body: Buffer): { topic: string; payload: Buffer; retain: boolean; id: number | null } {
  const topicLength = body.readUInt16BE(0);
  const topic = body.subarray(2, 2 + topicLength).toString('utf8');
  const qos = (flags >> 1) & 0x03;
  const offset = 2 + topicLength + (qos > 0 ? 2 : 0);
  return {
    topic,
    payload: body.subarray(offset),
    retain: (flags & 0x01) === 1,
    id: qos > 0 ? body.readUInt16BE(2 + topicLength) : null,
  };
}

export class MqttClient extends EventEmitter {
  readonly url: URL;
  connected = false;
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private backoffMs = 1_000;
  private pingTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(url: string) {
    super();
    this.url = new URL(url);
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.destroy();
  }

  subscribe(topics: readonly string[]): void {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(this.packetId());
    const filters = topics.map((topic) => Buffer.concat([str(topic), Buffer.from([0])]));
    this.write(packet(SUBSCRIBE, Buffer.concat([id, ...filters])));
  }

  publish(topic: string, payload: string, retain = false): boolean {
    return this.write(publishPacket(topic, payload, retain));
  }

  private packetId(): number {
    const id = this.nextId;
    this.nextId = id === 0xffff ? 1 : id + 1;
    return id;
  }

  private write(data: Buffer): boolean {
    if (!this.socket || !this.connected) {
      return false;
    }
    this.socket.write(data);
    return true;
  }

  private open(): void {
    const port = Number(this.url.port || 1883);
    const socket = tcpConnect({ host: this.url.hostname, port });
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on('connect', () => {
      const clientId = `parklane-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
      socket.write(
        connectPacket(clientId, decodeURIComponent(this.url.username), decodeURIComponent(this.url.password)),
      );
    });
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    // Connecting to "localhost" tries IPv6 and IPv4 and fails with an AggregateError whose message is empty.
    socket.on('error', (error: NodeJS.ErrnoException) =>
      log.warn('MQTT connection error', { broker: this.url.host, error: error.code ?? error.message }),
    );
    socket.on('close', () => {
      clearInterval(this.pingTimer);
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      if (wasConnected) {
        this.emit('close');
      }
      if (!this.stopped) {
        setTimeout(() => this.open(), this.backoffMs).unref();
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
    });
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let next;
      try {
        next = readPacket(this.buffer);
      } catch {
        this.socket?.destroy();
        return;
      }
      if (!next) {
        return;
      }
      this.buffer = this.buffer.subarray(next.size);
      this.handle(next.type, next.body);
    }
  }

  private handle(type: number, body: Buffer): void {
    switch (type & 0xf0) {
      case CONNACK:
        if (body[1] !== 0) {
          log.warn('MQTT broker refused the connection', { broker: this.url.host, code: body[1] });
          this.socket?.destroy();
          return;
        }
        this.connected = true;
        this.backoffMs = 1_000;
        this.pingTimer = setInterval(() => this.socket?.write(Buffer.from([PINGREQ, 0])), (KEEPALIVE_S * 1000) / 2);
        this.pingTimer.unref();
        this.emit('connect');
        return;
      case PUBLISH: {
        const message = parsePublish(type & 0x0f, body);
        if (message.id !== null) {
          const id = Buffer.alloc(2);
          id.writeUInt16BE(message.id);
          this.socket?.write(packet(PUBACK, id));
        }
        this.emit('message', message.topic, message.payload, message.retain);
        return;
      }
      case SUBACK:
      case PINGRESP:
      default:
    }
  }
}
