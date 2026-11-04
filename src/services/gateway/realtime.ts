import { gatewayConfig } from '../../constants/gatewayConfig';
import type { RealtimeState } from '../../types/ems.types';
import type { GatewayEvent } from '../../types/gateway.types';

/**
 * A gateway's event channel (/api/v1/events). Authenticates with the first
 * message, then delivers device, discovery, pairing and provisioning changes
 * as they happen. Drops reconnect with exponential back-off and jitter;
 * `wake()` reconnects at once. A refused token stops it for good.
 *
 * The same shape as services/ems/realtime.ts, against a base URL chosen at
 * runtime (the gateway's home, Tailscale or relay address).
 */
export class GatewayRealtime {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private baseUrl: string;
  private readonly token: string;
  private readonly onEvent: (event: GatewayEvent) => void;
  private readonly onState: (state: RealtimeState) => void;
  private readonly onRefused: () => void;

  constructor(
    baseUrl: string,
    token: string,
    handlers: { onEvent: (event: GatewayEvent) => void; onState: (state: RealtimeState) => void; onRefused: () => void },
  ) {
    this.baseUrl = baseUrl;
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

  /** Moves to another address of the same gateway (its IP changed, or the phone left home). */
  retarget(baseUrl: string) {
    if (baseUrl === this.baseUrl) {
      return;
    }
    this.baseUrl = baseUrl;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    if (!this.stopped) {
      this.clearTimer();
      this.attempt = 0;
      this.open();
    }
  }

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
    this.onState('connecting');
    const url = `${this.baseUrl.replace(/^http/, 'ws')}${gatewayConfig.apiPrefix}/events`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
    socket.onmessage = (message) => {
      let event: GatewayEvent;
      try {
        event = JSON.parse(String(message.data)) as GatewayEvent;
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
    const base = Math.min(gatewayConfig.reconnectMaxMs, gatewayConfig.reconnectMinMs * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }
}
