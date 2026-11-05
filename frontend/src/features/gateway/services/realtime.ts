import { gatewayConfig } from '../../../config/gateway';
import { ReconnectingSocket, type SocketHandlers } from '../../../lib/realtime/ReconnectingSocket';
import type { GatewayEvent } from '../../../types/gateway.types';

/**
 * A gateway's event channel (/api/v1/events). Authenticates with the first
 * message, then delivers device, discovery, pairing and provisioning changes
 * as they happen. Drops reconnect with exponential back-off and jitter;
 * `wake()` reconnects at once. A refused token stops it for good.
 *
 * Unlike the EMS channel, its base URL is chosen at runtime (the gateway's
 * home, Tailscale or relay address) and can change while it runs.
 */
export class GatewayRealtime extends ReconnectingSocket<GatewayEvent> {
  private baseUrl: string;

  constructor(baseUrl: string, token: string, handlers: SocketHandlers<GatewayEvent>) {
    super(token, handlers, { minMs: gatewayConfig.reconnectMinMs, maxMs: gatewayConfig.reconnectMaxMs });
    this.baseUrl = baseUrl;
  }

  /** Moves to another address of the same gateway (its IP changed, or the phone left home). */
  retarget(baseUrl: string) {
    if (baseUrl === this.baseUrl) {
      return;
    }
    this.baseUrl = baseUrl;
    this.reconnect();
  }

  protected url(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}${gatewayConfig.apiPrefix}/events`;
  }

  /** A typed address the WebSocket refuses outright is tried again later, like a dropped one. */
  protected onConnectFailed(): void {
    this.scheduleReconnect();
  }
}
