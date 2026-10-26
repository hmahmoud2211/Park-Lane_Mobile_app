import { emsConfig } from '../../constants/emsConfig';
import type { EmsEvent, RealtimeState } from '../../types/ems.types';

/**
 * The backend's realtime channel (/api/events). Authenticates with the first
 * message, then delivers device and Alexa changes as they happen, whoever
 * caused them. Drops reconnect with exponential back-off (1 s up to 30 s,
 * with jitter); `wake()` reconnects at once, e.g. when the app returns to
 * the foreground. A refused token stops it: the session is no longer valid.
 */
export class EmsRealtime {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly token: string;
  private readonly onEvent: (event: EmsEvent) => void;
  private readonly onState: (state: RealtimeState) => void;
  private readonly onRefused: () => void;

  constructor(
    token: string,
    handlers: { onEvent: (event: EmsEvent) => void; onState: (state: RealtimeState) => void; onRefused: () => void },
  ) {
    this.token = token;
    this.onEvent = handlers.onEvent;
    this.onState = handlers.onState;
    this.onRefused = handlers.onRefused;
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
    this.onState('offline');
  }

  /** Reconnects now if the channel is down (foregrounding, pull to refresh). */
  wake() {
    if (!this.stopped && !this.socket) {
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
    if (!emsConfig.eventsUrl) {
      this.onState('offline');
      return;
    }
    this.onState('connecting');
    const socket = new WebSocket(emsConfig.eventsUrl);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
    socket.onmessage = (message) => {
      let event: EmsEvent;
      try {
        event = JSON.parse(String(message.data)) as EmsEvent;
      } catch {
        return;
      }
      if (event.type === 'ready') {
        this.attempt = 0;
        this.onState('live');
      } else if (event.type === 'error' && event.code === 'unauthorized') {
        this.stopped = true;
        this.onRefused();
      }
      this.onEvent(event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.onState('offline');
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
    socket.onerror = () => {
      // onclose follows and reconnects.
    };
  }

  private scheduleReconnect() {
    const base = Math.min(emsConfig.reconnectMaxMs, emsConfig.reconnectMinMs * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }
}
