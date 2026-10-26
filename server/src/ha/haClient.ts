import { log } from '../log.ts';

/**
 * One connection to a Home Assistant WebSocket API (/api/websocket), using
 * Node's built-in WebSocket client.
 *
 * Handshake: HA sends auth_required, we answer { type: 'auth', access_token },
 * HA answers auth_ok or auth_invalid. After that every message carries an id;
 * results answer commands and events feed subscriptions. Coalesced messages
 * (several in one JSON array) are turned on and handled.
 *
 * Drops reconnect with back-off (1 s up to 60 s, with jitter). Subscriptions
 * do not survive a reconnect: `onReady` runs after every successful login and
 * is where the owner subscribes again. A rejected token stops the connection
 * until `start()` is called with a new one.
 */

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'auth_failed';

export class HaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HaError';
    this.code = code;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface HaMessage {
  id?: number;
  type: string;
  success?: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  event?: unknown;
  ha_version?: string;
  message?: string;
}

export interface HaConnectionOptions {
  /** The hub's base URL, e.g. http://parklane-ha-1203:8123. */
  baseUrl: string;
  token: string;
  onReady: (connection: HaConnection) => Promise<void>;
  onStatus: (status: ConnectionStatus, detail: { haVersion?: string; error?: string }) => void;
  commandTimeoutMs?: number;
}

const PING_MS = 30_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

export function websocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/websocket`;
}

export class HaConnection {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly subscriptions = new Map<number, (event: unknown) => void>();
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly options: HaConnectionOptions;
  private token: string;
  status: ConnectionStatus = 'offline';
  haVersion: string | null = null;

  constructor(options: HaConnectionOptions) {
    this.options = options;
    this.token = options.token;
  }

  start(token?: string) {
    if (token) {
      this.token = token;
    }
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardown(new HaError('stopped', 'The connection was stopped.'));
    this.setStatus('offline', {});
  }

  /** Sends a command and resolves with its result, or rejects with HaError. */
  command<T>(message: Record<string, unknown>, timeoutMs = this.options.commandTimeoutMs ?? 10_000): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || (this.status !== 'online' && this.status !== 'connecting')) {
      return Promise.reject(new HaError('not_connected', 'The hub is not connected.'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HaError('timeout', 'The hub took too long to answer.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ ...message, id }));
    });
  }

  /** Starts a subscription; `onEvent` gets each event's payload until the connection drops. */
  async subscribe(message: Record<string, unknown>, onEvent: (event: unknown) => void): Promise<void> {
    const id = this.nextId;
    // Registered first: HA can send the first event right after the result.
    this.subscriptions.set(id, onEvent);
    try {
      await this.command(message);
    } catch (error) {
      this.subscriptions.delete(id);
      throw error;
    }
  }

  private connect() {
    this.teardown(new HaError('reconnecting', 'The connection was reset.'));
    this.setStatus('connecting', {});
    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl(this.options.baseUrl));
    } catch (error) {
      this.scheduleReconnect((error as Error).message);
      return;
    }
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        this.handle(socket, message as HaMessage);
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.scheduleReconnect('connection closed');
      }
    });
    socket.addEventListener('error', () => {
      // A close event follows; reconnecting happens there.
    });
  }

  private handle(socket: WebSocket, message: HaMessage) {
    switch (message.type) {
      case 'auth_required':
        socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        return;
      case 'auth_invalid':
        log.warn('Home Assistant refused the token', { hub: this.options.baseUrl });
        this.stopped = true;
        this.teardown(new HaError('auth_invalid', message.message ?? 'Invalid access token.'));
        this.setStatus('auth_failed', { error: message.message ?? 'Invalid access token.' });
        return;
      case 'auth_ok':
        this.haVersion = message.ha_version ?? null;
        void this.ready(socket);
        return;
      case 'result': {
        const waiting = message.id !== undefined ? this.pending.get(message.id) : undefined;
        if (!waiting || message.id === undefined) {
          return;
        }
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.success) {
          waiting.resolve(message.result);
        } else {
          waiting.reject(new HaError(message.error?.code ?? 'unknown_error', message.error?.message ?? 'The hub refused the request.'));
        }
        return;
      }
      case 'pong': {
        const waiting = message.id !== undefined ? this.pending.get(message.id) : undefined;
        if (waiting && message.id !== undefined) {
          this.pending.delete(message.id);
          clearTimeout(waiting.timer);
          waiting.resolve(undefined);
        }
        return;
      }
      case 'event':
        if (message.id !== undefined) {
          this.subscriptions.get(message.id)?.(message.event);
        }
        return;
      default:
        return;
    }
  }

  private async ready(socket: WebSocket) {
    try {
      await this.command({ type: 'supported_features', features: { coalesce_messages: 1 } });
      await this.options.onReady(this);
    } catch (error) {
      log.warn('Home Assistant setup after login failed', { hub: this.options.baseUrl, reason: (error as Error).message });
      socket.close();
      return;
    }
    if (this.socket !== socket) {
      return;
    }
    this.attempt = 0;
    this.setStatus('online', { haVersion: this.haVersion ?? undefined });
    this.pingTimer = setInterval(() => {
      this.command({ type: 'ping' }).catch(() => socket.close());
    }, PING_MS);
  }

  private scheduleReconnect(reason: string) {
    this.teardown(new HaError('disconnected', 'The hub disconnected.'));
    if (this.stopped) {
      return;
    }
    this.setStatus('offline', { error: reason });
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private teardown(reason: Error) {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(reason);
    }
    this.pending.clear();
    this.subscriptions.clear();
  }

  private setStatus(status: ConnectionStatus, detail: { haVersion?: string; error?: string }) {
    if (status === this.status && status !== 'offline') {
      return;
    }
    this.status = status;
    this.options.onStatus(status, detail);
  }
}
