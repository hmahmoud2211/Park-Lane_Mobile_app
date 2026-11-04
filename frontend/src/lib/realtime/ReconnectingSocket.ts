import type { RealtimeState } from '../../types/ems.types';

/** What a channel tells its owner. */
export interface SocketHandlers<E> {
  onEvent: (event: E) => void;
  onState: (state: RealtimeState) => void;
  /** The server refused the token; the channel has stopped for good. */
  onRefused: () => void;
}

/** Every event channel answers its auth message with one of these. */
type ControlEvent = { type: 'ready' } | { type: 'error'; code: string };

/**
 * An event channel over WebSocket, as the EMS backend and the CUBE gateway run them: it
 * authenticates with its first message (`{ type: 'auth', token }`), goes live on `ready`,
 * and stops for good on `{ type: 'error', code: 'unauthorized' }`. A dropped connection
 * reconnects with exponential back-off and jitter (half to all of min * 2^n, capped);
 * `wake()` reconnects at once, e.g. when the app returns to the foreground.
 */
export abstract class ReconnectingSocket<E extends { type: string }> {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  protected constructor(
    private readonly token: string,
    private readonly handlers: SocketHandlers<E>,
    private readonly backoff: { minMs: number; maxMs: number },
  ) {}

  /** The address to connect to now; '' when there is none, and the channel stays offline. */
  protected abstract url(): string;

  /** When `new WebSocket` itself throws (a malformed address): by default the error propagates. */
  protected onConnectFailed(error: unknown): void {
    throw error;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.handlers.onState('offline');
  }

  /** Reconnects now if the channel is down (foregrounding, pull to refresh). */
  wake() {
    if (!this.stopped && !this.socket) {
      this.clearTimer();
      this.attempt = 0;
      this.open();
    }
  }

  /** Drops the current connection and, unless stopped, connects again at once (to a new url()). */
  protected reconnect() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    if (!this.stopped) {
      this.clearTimer();
      this.attempt = 0;
      this.open();
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private open() {
    const url = this.url();
    if (!url) {
      this.handlers.onState('offline');
      return;
    }
    this.handlers.onState('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.onConnectFailed(error);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
    socket.onmessage = (message) => {
      let event: E;
      try {
        event = JSON.parse(String(message.data)) as E;
      } catch {
        return;
      }
      const control = event as unknown as ControlEvent;
      if (control.type === 'ready') {
        this.attempt = 0;
        this.handlers.onState('live');
      } else if (control.type === 'error' && control.code === 'unauthorized') {
        this.stopped = true;
        this.handlers.onRefused();
      }
      this.handlers.onEvent(event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.handlers.onState('offline');
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
    socket.onerror = () => {
      // onclose follows and reconnects.
    };
  }

  protected scheduleReconnect() {
    const base = Math.min(this.backoff.maxMs, this.backoff.minMs * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }
}
