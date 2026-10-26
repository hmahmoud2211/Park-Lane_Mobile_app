import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { lookupToken } from './auth.ts';
import { subscribe, type UserEvent } from './events.ts';

/**
 * GET /api/events (WebSocket): changes pushed to the app.
 *
 * A minimal RFC 6455 server, so the backend stays dependency-free: text
 * frames out, and in only the client's auth message, pings and close.
 * Browsers cannot set headers on a WebSocket, so the client authenticates
 * with its first message, { type: 'auth', token }, within 10 seconds.
 * The server pings every 25 seconds; clients reconnect with back-off.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 4096;
const AUTH_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65_536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : (() => {
            const value = Buffer.alloc(10);
            value[0] = 0x80 | opcode;
            value[1] = 127;
            value.writeBigUInt64BE(BigInt(length), 2);
            return value;
          })();
  return Buffer.concat([header, payload]);
}

class Connection {
  private buffer = Buffer.alloc(0);
  private closed = false;
  private unsubscribe: (() => void) | null = null;
  private readonly authTimer: NodeJS.Timeout;
  private readonly pingTimer: NodeJS.Timeout;
  private readonly socket: Duplex;

  constructor(socket: Duplex) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => this.cleanup());
    socket.on('error', () => this.cleanup());
    this.authTimer = setTimeout(() => this.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    this.pingTimer = setInterval(() => this.write(frame(0x9, Buffer.alloc(0))), PING_MS);
  }

  private write(data: Buffer) {
    if (!this.closed && this.socket.writable) {
      this.socket.write(data);
    }
  }

  send(message: object) {
    this.write(frame(0x1, Buffer.from(JSON.stringify(message))));
  }

  close(code = 1000, reason = '') {
    if (this.closed) {
      return;
    }
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.write(frame(0x8, payload));
    this.closed = true;
    this.socket.end();
    this.cleanup();
  }

  private cleanup() {
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.pingTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
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
      } else if (length === 127) {
        this.close(1009, 'too large');
        return;
      }
      // Clients must mask, and nothing they need to send is large.
      if (!masked || length > MAX_FRAME || (first & 0x80) === 0) {
        this.close(1002, 'protocol error');
        return;
      }
      if (this.buffer.length < offset + 4 + length) {
        return;
      }
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(offset + 4 + length);
      this.handle(opcode, payload);
    }
  }

  private handle(opcode: number, payload: Buffer) {
    if (opcode === 0x8) {
      this.close(1000);
    } else if (opcode === 0x9) {
      this.write(frame(0xa, payload));
    } else if (opcode === 0x1 && !this.unsubscribe) {
      this.authenticate(payload.toString('utf8'));
    }
  }

  private authenticate(text: string) {
    let token = '';
    try {
      const message = JSON.parse(text) as { type?: string; token?: string };
      token = message.type === 'auth' && typeof message.token === 'string' ? message.token : '';
    } catch {
      token = '';
    }
    const found = lookupToken(token, ['session']);
    if (!found) {
      this.send({ type: 'error', code: 'unauthorized' });
      this.close(4401, 'unauthorized');
      return;
    }
    clearTimeout(this.authTimer);
    this.unsubscribe = subscribe(found.user_id, (event: UserEvent) => this.send(event));
    this.send({ type: 'ready' });
  }
}

/** Upgraded sockets are not the HTTP server's any more, so closing it has to end them here. */
const open = new Set<Duplex>();

export function closeRealtimeConnections(): void {
  for (const socket of open) {
    socket.destroy();
  }
  open.clear();
}

export function attachRealtime(server: Server): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
    const path = new URL(req.url ?? '/', 'http://backend').pathname;
    const key = req.headers['sec-websocket-key'];
    if (path !== '/api/events' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join(
        '\r\n',
      ),
    );
    new Connection(socket);
  });
}
