import { createServer as createTcpServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

import { log } from '../log.ts';
import {
  ACCEPTED,
  BAD_CREDENTIALS,
  BAD_PROTOCOL,
  CONNECT,
  DISCONNECT,
  NOT_AUTHORIZED,
  PINGREQ,
  PUBLISH,
  PUBREL,
  SUBSCRIBE,
  UNSUBSCRIBE,
  connack,
  parseConnect,
  parsePublish,
  parseSubscribe,
  pingresp,
  puback,
  pubcomp,
  publishPacket,
  pubrec,
  readPacket,
  suback,
  unsuback,
} from './mqttCodec.ts';

/**
 * Where direct devices connect: an MQTT 3.1.1 endpoint in this backend, not
 * a broker. Each device logs in with its own username and password, so every
 * message is tied to the device that sent it, whatever topic it names, and
 * the backend writes commands straight to that device's connection. Nothing
 * is routed between devices.
 *
 * Packets: CONNECT, PUBLISH at QoS 0–2 (acknowledged as the device expects),
 * SUBSCRIBE and UNSUBSCRIBE (granted at QoS 0), PINGREQ and DISCONNECT. A
 * connection that stays quiet for 1.5× its keep-alive is dropped.
 */

const CONNECT_TIMEOUT_MS = 10_000;
/** Tasmota's own messages stay well under this; discovery is the largest at a couple of KB. */
const MAX_PACKET_BYTES = 64 * 1024;
/** A device that asks for no keep-alive still goes after this long without a packet. */
const DEFAULT_IDLE_MS = 10 * 60_000;

export interface DeviceSession {
  readonly username: string;
  readonly address: string;
  publish(topic: string, payload: string): void;
  close(): void;
}

export interface DeviceEndpointHandlers {
  /** Whether this login may connect; refused logins get "bad username or password". */
  authenticate(username: string, password: string, address: string): 'ok' | 'refused' | 'limited';
  onConnect(session: DeviceSession): void;
  /** The device subscribed, so it now hears commands. */
  onSubscribe(session: DeviceSession, filters: string[]): void;
  onMessage(session: DeviceSession, topic: string, payload: Buffer): void;
  onClose(session: DeviceSession): void;
}

class Connection implements DeviceSession {
  username = '';
  readonly address: string;
  private readonly socket: Socket;
  private readonly handlers: DeviceEndpointHandlers;
  private buffer = Buffer.alloc(0);
  private connected = false;
  private closed = false;
  private idleMs = CONNECT_TIMEOUT_MS;
  private idleTimer: NodeJS.Timeout;
  /** QoS 2 packet ids received and not yet released, so a resend is not handled twice. */
  private readonly received = new Set<number>();

  constructor(socket: Socket, handlers: DeviceEndpointHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    this.address = socket.remoteAddress ?? 'unknown';
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () => this.close());
    socket.on('close', () => this.cleanup());
    this.idleTimer = setTimeout(() => this.close(), this.idleMs);
  }

  publish(topic: string, payload: string): void {
    this.write(publishPacket(topic, payload));
  }

  close(): void {
    this.socket.destroy();
  }

  private write(data: Buffer) {
    if (!this.closed && this.socket.writable) {
      this.socket.write(data);
    }
  }

  private cleanup() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.idleTimer);
    if (this.connected) {
      this.handlers.onClose(this);
    }
  }

  private receive(chunk: Buffer) {
    this.idleTimer.refresh();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_PACKET_BYTES + 5) {
      this.close();
      return;
    }
    for (;;) {
      let next;
      try {
        next = readPacket(this.buffer);
        if (!next) {
          return;
        }
        this.buffer = this.buffer.subarray(next.size);
        this.handle(next.type, next.body);
      } catch {
        // Malformed, or a handler failed on it: a well-behaved device never gets here.
        this.close();
        return;
      }
      if (this.closed) {
        return;
      }
    }
  }

  private handle(type: number, body: Buffer) {
    const kind = type & 0xf0;
    if (!this.connected) {
      if (kind !== CONNECT) {
        this.close();
        return;
      }
      this.handleConnect(body);
      return;
    }
    switch (kind) {
      case PUBLISH: {
        const message = parsePublish(type & 0x0f, body);
        if (message.qos === 1 && message.id !== null) {
          this.write(puback(message.id));
        } else if (message.qos === 2 && message.id !== null) {
          this.write(pubrec(message.id));
          if (this.received.has(message.id)) {
            return;
          }
          this.received.add(message.id);
        }
        this.handlers.onMessage(this, message.topic, message.payload);
        return;
      }
      case PUBREL: {
        const id = body.readUInt16BE(0);
        this.received.delete(id);
        this.write(pubcomp(id));
        return;
      }
      case SUBSCRIBE: {
        const { id, filters } = parseSubscribe(body, true);
        this.write(suback(id, filters.length));
        this.handlers.onSubscribe(this, filters);
        return;
      }
      case UNSUBSCRIBE:
        this.write(unsuback(parseSubscribe(body, false).id));
        return;
      case PINGREQ:
        this.write(pingresp());
        return;
      case DISCONNECT:
        this.close();
        return;
      default:
      // PUBACK and the like: the backend only sends at QoS 0, so there is nothing to match.
    }
  }

  private handleConnect(body: Buffer) {
    const request = parseConnect(body);
    // 4 is MQTT 3.1.1; 3 is 3.1 (MQIsdp), which older firmware still speaks.
    if (!(request.protocol === 'MQTT' && request.level === 4) && !(request.protocol === 'MQIsdp' && request.level === 3)) {
      this.write(connack(BAD_PROTOCOL));
      this.close();
      return;
    }
    const verdict = request.username ? this.handlers.authenticate(request.username, request.password, this.address) : 'refused';
    if (verdict !== 'ok') {
      log.warn('Direct device refused', { username: request.username || '(none)', address: this.address, reason: verdict });
      this.write(connack(verdict === 'limited' ? NOT_AUTHORIZED : BAD_CREDENTIALS));
      this.close();
      return;
    }
    this.username = request.username;
    this.connected = true;
    this.idleMs = request.keepAliveS > 0 ? request.keepAliveS * 1500 : DEFAULT_IDLE_MS;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), this.idleMs);
    this.write(connack(ACCEPTED));
    this.handlers.onConnect(this);
  }
}

export interface DeviceEndpointOptions {
  host: string;
  port: number;
  /** PEM certificate chain and key; null listens without TLS (development and tests). */
  tls: { cert: string; key: string } | null;
}

let server: Server | null = null;
const connections = new Set<Connection>();

export function startDeviceEndpoint(options: DeviceEndpointOptions, handlers: DeviceEndpointHandlers): Promise<void> {
  const onSocket = (socket: Socket) => {
    const connection = new Connection(socket, handlers);
    connections.add(connection);
    socket.on('close', () => connections.delete(connection));
  };
  server = options.tls ? createTlsServer({ cert: options.tls.cert, key: options.tls.key }, onSocket) : createTcpServer(onSocket);
  // A failed TLS handshake (a scanner, a plug without TLS) is not worth more than this.
  server.on('tlsClientError', () => undefined);
  const listening = server;
  return new Promise((resolve, reject) => {
    listening.once('error', reject);
    listening.listen(options.port, options.host, () => {
      listening.off('error', reject);
      resolve();
    });
  });
}

export function stopDeviceEndpoint(): Promise<void> {
  for (const connection of connections) {
    connection.close();
  }
  connections.clear();
  const closing = server;
  server = null;
  return closing ? new Promise((resolve) => closing.close(() => resolve())) : Promise.resolve();
}
