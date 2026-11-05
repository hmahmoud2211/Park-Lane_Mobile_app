/**
 * The little of MQTT 3.1.1 that direct mode needs, in both directions:
 * reading what a device sends (CONNECT, PUBLISH, SUBSCRIBE…) and writing
 * what it expects back. Taken from the rethink client on Master
 * (server/src/rethink/mqtt.ts), so the backend keeps no dependencies. The
 * tests use the client half to stand in for a Tasmota plug.
 */

export const CONNECT = 0x10;
export const CONNACK = 0x20;
export const PUBLISH = 0x30;
export const PUBACK = 0x40;
export const PUBREC = 0x50;
export const PUBREL = 0x60;
export const PUBCOMP = 0x70;
export const SUBSCRIBE = 0x80;
export const SUBACK = 0x90;
export const UNSUBSCRIBE = 0xa0;
export const UNSUBACK = 0xb0;
export const PINGREQ = 0xc0;
export const PINGRESP = 0xd0;
export const DISCONNECT = 0xe0;

/** CONNACK return codes (MQTT 3.1.1, 3.2.2.3). */
export const ACCEPTED = 0;
export const BAD_PROTOCOL = 1;
export const BAD_CREDENTIALS = 4;
export const NOT_AUTHORIZED = 5;

export function str(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function packet(type: number, body: Buffer): Buffer {
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

const idBytes = (id: number) => {
  const value = Buffer.alloc(2);
  value.writeUInt16BE(id);
  return value;
};

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

/** Reads length-prefixed fields off a packet body, throwing on a short one. */
class Reader {
  private offset = 0;
  private readonly body: Buffer;

  constructor(body: Buffer) {
    this.body = body;
  }

  get done() {
    return this.offset >= this.body.length;
  }

  byte(): number {
    if (this.offset >= this.body.length) throw new Error('Short MQTT packet.');
    return this.body[this.offset++];
  }

  uint16(): number {
    if (this.offset + 2 > this.body.length) throw new Error('Short MQTT packet.');
    const value = this.body.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  bytes(): Buffer {
    const length = this.uint16();
    if (this.offset + length > this.body.length) throw new Error('Short MQTT packet.');
    const value = this.body.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  text(): string {
    return this.bytes().toString('utf8');
  }

  rest(): Buffer {
    return this.body.subarray(this.offset);
  }
}

export interface ConnectRequest {
  protocol: string;
  level: number;
  clientId: string;
  keepAliveS: number;
  username: string;
  password: string;
}

export function parseConnect(body: Buffer): ConnectRequest {
  const read = new Reader(body);
  const protocol = read.text();
  const level = read.byte();
  const flags = read.byte();
  const keepAliveS = read.uint16();
  const clientId = read.text();
  if (flags & 0x04) {
    read.text(); // will topic: the connection's own close says the device went offline
    read.bytes(); // will message
  }
  const username = flags & 0x80 ? read.text() : '';
  const password = flags & 0x40 ? read.text() : '';
  return { protocol, level, clientId, keepAliveS, username, password };
}

export function parsePublish(flags: number, body: Buffer): { topic: string; payload: Buffer; qos: number; id: number | null } {
  const read = new Reader(body);
  const topic = read.text();
  const qos = (flags >> 1) & 0x03;
  const id = qos > 0 ? read.uint16() : null;
  return { topic, payload: read.rest(), qos, id };
}

/** A SUBSCRIBE's packet id and topic filters (UNSUBSCRIBE has the same shape without the QoS byte). */
export function parseSubscribe(body: Buffer, withQos: boolean): { id: number; filters: string[] } {
  const read = new Reader(body);
  const id = read.uint16();
  const filters: string[] = [];
  while (!read.done) {
    filters.push(read.text());
    if (withQos) read.byte();
  }
  return { id, filters };
}

export const connack = (code: number) => packet(CONNACK, Buffer.from([0, code]));
export const puback = (id: number) => packet(PUBACK, idBytes(id));
export const pubrec = (id: number) => packet(PUBREC, idBytes(id));
export const pubcomp = (id: number) => packet(PUBCOMP, idBytes(id));
export const suback = (id: number, count: number) => packet(SUBACK, Buffer.concat([idBytes(id), Buffer.alloc(count, 0)]));
export const unsuback = (id: number) => packet(UNSUBACK, idBytes(id));
export const pingresp = () => Buffer.from([PINGRESP, 0]);

export function publishPacket(topic: string, payload: string | Buffer, retain = false): Buffer {
  return packet(PUBLISH | (retain ? 0x01 : 0), Buffer.concat([str(topic), Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')]));
}

// ---- The client half: what a device sends ------------------------------------------------------

export function connectPacket(clientId: string, username: string, password: string, keepAliveS = 30): Buffer {
  const flags = 0x02 | (username ? 0x80 : 0) | (password ? 0x40 : 0);
  const keepAlive = Buffer.alloc(2);
  keepAlive.writeUInt16BE(keepAliveS);
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

export function subscribePacket(id: number, filters: readonly string[]): Buffer {
  return packet(SUBSCRIBE | 0x02, Buffer.concat([idBytes(id), ...filters.map((filter) => Buffer.concat([str(filter), Buffer.from([0])]))]));
}
