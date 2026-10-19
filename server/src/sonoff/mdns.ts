import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';

import { log } from '../log.ts';

/**
 * A small DNS-SD browser for `_ewelink._tcp.local`, the service eWeLink
 * Wi-Fi devices announce on the LAN once they are on Wi-Fi (the eWeLink LAN
 * protocol, as SonoffLAN and ITEAD's DIY-mode docs describe it). Instances
 * are named `eWeLink_<deviceid>`; the TXT record carries `id`, `type`,
 * `encrypt`, `iv` and the state in `data1`..`data4`.
 *
 * It listens on 5353 alongside the OS responder when the OS allows, and
 * otherwise asks with the "unicast response" bit from a spare port.
 */

export const EWELINK_SERVICE = '_ewelink._tcp.local';
const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;

export interface MdnsRecord {
  name: string;
  type: number;
  ttl: number;
  /** PTR: the instance. SRV: the target host. */
  target?: string;
  port?: number;
  address?: string;
  txt?: Record<string, string>;
}

export interface EwelinkService {
  instance: string;
  deviceId: string;
  host: string;
  port: number;
  txt: Record<string, string>;
  seenAt: number;
}

// ---- DNS wire format ---------------------------------------------------------------

function encodeName(name: string): Buffer {
  const parts = name.split('.').filter(Boolean).map((label) => {
    const bytes = Buffer.from(label, 'utf8');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

export function buildQuery(name: string, unicastResponse: boolean): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE_PTR, 0);
  tail.writeUInt16BE(unicastResponse ? 0x8001 : 0x0001, 2);
  return Buffer.concat([header, encodeName(name), tail]);
}

function readName(buffer: Buffer, start: number): [string, number] {
  const labels: string[] = [];
  let offset = start;
  let end = -1;
  for (let jumps = 0; jumps < 64; ) {
    if (offset >= buffer.length) {
      throw new Error('name runs past the packet');
    }
    const length = buffer[offset];
    if (length === 0) {
      return [labels.join('.'), end === -1 ? offset + 1 : end];
    }
    if ((length & 0xc0) === 0xc0) {
      if (end === -1) {
        end = offset + 2;
      }
      offset = ((length & 0x3f) << 8) | buffer[offset + 1];
      jumps += 1;
      continue;
    }
    labels.push(buffer.toString('utf8', offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  throw new Error('name has too many pointers');
}

function readTxt(buffer: Buffer, start: number, length: number): Record<string, string> {
  const txt: Record<string, string> = {};
  let offset = start;
  while (offset < start + length) {
    const size = buffer[offset];
    const entry = buffer.toString('utf8', offset + 1, offset + 1 + size);
    const equals = entry.indexOf('=');
    if (equals > 0) {
      txt[entry.slice(0, equals)] = entry.slice(equals + 1);
    }
    offset += 1 + size;
  }
  return txt;
}

/** Every answer, authority and additional record in a response; questions are skipped. */
export function parseRecords(buffer: Buffer): MdnsRecord[] {
  if (buffer.length < 12 || (buffer.readUInt16BE(2) & 0x8000) === 0) {
    return []; // too short, or a query rather than a response
  }
  const questions = buffer.readUInt16BE(4);
  const records = buffer.readUInt16BE(6) + buffer.readUInt16BE(8) + buffer.readUInt16BE(10);
  let offset = 12;
  for (let index = 0; index < questions; index += 1) {
    offset = readName(buffer, offset)[1] + 4;
  }
  const result: MdnsRecord[] = [];
  for (let index = 0; index < records; index += 1) {
    const [name, afterName] = readName(buffer, offset);
    const type = buffer.readUInt16BE(afterName);
    const ttl = buffer.readUInt32BE(afterName + 4);
    const length = buffer.readUInt16BE(afterName + 8);
    const data = afterName + 10;
    const record: MdnsRecord = { name, type, ttl };
    if (type === TYPE_PTR) {
      record.target = readName(buffer, data)[0];
    } else if (type === TYPE_SRV) {
      record.port = buffer.readUInt16BE(data + 4);
      record.target = readName(buffer, data + 6)[0];
    } else if (type === TYPE_TXT) {
      record.txt = readTxt(buffer, data, length);
    } else if (type === TYPE_A && length === 4) {
      record.address = [...buffer.subarray(data, data + 4)].join('.');
    }
    result.push(record);
    offset = data + length;
  }
  return result;
}

// ---- The browser -------------------------------------------------------------------

const lower = (name: string) => name.toLowerCase();

/** `eWeLink_1000abcdef._ewelink._tcp.local` -> `1000abcdef`. */
export function deviceIdOf(instance: string, txt?: Record<string, string>): string | null {
  if (txt?.id) {
    return txt.id.toLowerCase();
  }
  const match = /^ewelink_([0-9a-f]{10})/i.exec(instance);
  return match ? match[1].toLowerCase() : null;
}

export class EwelinkBrowser extends EventEmitter<{ service: [EwelinkService] }> {
  private socket: Socket | null = null;
  private unicast = false;
  private readonly srv = new Map<string, { target: string; port: number }>();
  private readonly txt = new Map<string, Record<string, string>>();
  private readonly addresses = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  private readonly seen = new Map<string, number>();
  private readonly iface: string | undefined;

  constructor(iface?: string) {
    super();
    this.iface = iface;
  }

  get listening(): boolean {
    return this.socket !== null;
  }

  async start(): Promise<void> {
    try {
      this.socket = await this.open(MDNS_PORT);
    } catch (error) {
      log.warn('mDNS: port 5353 is taken, asking for unicast answers instead', {
        reason: (error as Error).message,
      });
      this.socket = await this.open(0);
      this.unicast = true;
    }
  }

  private open(port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      socket.once('error', reject);
      socket.on('message', (message, remote) => this.receive(message, remote));
      socket.bind(port, () => {
        socket.off('error', reject);
        socket.on('error', (error) => log.warn('mDNS socket error', { reason: error.message }));
        try {
          socket.addMembership(MDNS_GROUP, this.iface);
          if (this.iface) {
            socket.setMulticastInterface(this.iface);
          }
          socket.setMulticastTTL(255);
        } catch (error) {
          if (port !== 0) {
            socket.close();
            reject(error);
            return;
          }
        }
        resolve(socket);
      });
    });
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
  }

  /** Asks every eWeLink device to announce itself. */
  query(): void {
    this.socket?.send(buildQuery(EWELINK_SERVICE, this.unicast), MDNS_PORT, MDNS_GROUP);
  }

  private receive(message: Buffer, remote: RemoteInfo): void {
    let records: MdnsRecord[];
    try {
      records = parseRecords(message);
    } catch {
      return; // not a packet worth reading
    }
    const touched = new Set<string>();
    for (const record of records) {
      const name = lower(record.name);
      if (record.type === TYPE_PTR && name === EWELINK_SERVICE && record.target) {
        const instance = lower(record.target);
        if (record.ttl === 0) {
          this.forget(instance);
        } else {
          this.sources.set(instance, remote.address);
          touched.add(instance);
        }
      } else if (record.type === TYPE_SRV && record.target && record.port !== undefined) {
        this.srv.set(name, { target: lower(record.target), port: record.port });
        this.sources.set(name, remote.address);
        touched.add(name);
      } else if (record.type === TYPE_TXT && record.txt) {
        this.txt.set(name, record.txt);
        touched.add(name);
      } else if (record.type === TYPE_A && record.address) {
        this.addresses.set(name, record.address);
      }
    }
    for (const instance of touched) {
      const service = this.service(instance);
      if (service) {
        this.seen.set(instance, Date.now());
        this.emit('service', { ...service, seenAt: Date.now() });
      }
    }
  }

  private forget(instance: string): void {
    this.srv.delete(instance);
    this.txt.delete(instance);
    this.seen.delete(instance);
  }

  /** An instance with enough known about it to talk to. */
  private service(instance: string): EwelinkService | null {
    if (!instance.endsWith(`.${EWELINK_SERVICE}`)) {
      return null;
    }
    const txt = this.txt.get(instance) ?? {};
    const deviceId = deviceIdOf(instance, txt);
    const srv = this.srv.get(instance);
    const host = (srv && this.addresses.get(srv.target)) ?? this.sources.get(instance);
    if (!deviceId || !host) {
      return null;
    }
    return { instance, deviceId, host, port: srv?.port ?? 0, txt, seenAt: this.seen.get(instance) ?? 0 };
  }

  /** The latest announcement from `deviceId`, if one has been heard since `since`. */
  find(deviceId: string, since = 0): EwelinkService | null {
    for (const instance of new Set([...this.srv.keys(), ...this.txt.keys()])) {
      const service = this.service(instance);
      if (service && service.deviceId === deviceId && service.seenAt >= since) {
        return service;
      }
    }
    return null;
  }

  /** Queries, then waits up to `windowMs` for `deviceId` to answer. */
  lookFor(deviceId: string, windowMs: number): Promise<EwelinkService | null> {
    const since = Date.now();
    return new Promise((resolve) => {
      const onService = (service: EwelinkService) => {
        if (service.deviceId === deviceId) {
          done(service);
        }
      };
      const timer = setTimeout(() => done(this.find(deviceId, since)), windowMs);
      const resend = setTimeout(() => this.query(), Math.min(1_000, windowMs / 2));
      const done = (service: EwelinkService | null) => {
        clearTimeout(timer);
        clearTimeout(resend);
        this.off('service', onService);
        resolve(service);
      };
      this.on('service', onService);
      this.query();
    });
  }
}
