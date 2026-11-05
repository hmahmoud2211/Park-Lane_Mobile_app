import { emsConfig } from '../../../config/ems';
import { ReconnectingSocket, type SocketHandlers } from '../../../lib/realtime/ReconnectingSocket';
import type { EmsEvent } from '../../../types/ems.types';

/**
 * The backend's realtime channel (/api/events). Authenticates with the first
 * message, then delivers device changes as they happen, whoever caused them.
 * Drops reconnect with exponential back-off (1 s up to 30 s, with jitter);
 * `wake()` reconnects at once, e.g. when the app returns to the foreground.
 * A refused token stops it: the session is no longer valid. Without a backend
 * address in the build it stays offline.
 */
export class EmsRealtime extends ReconnectingSocket<EmsEvent> {
  constructor(token: string, handlers: SocketHandlers<EmsEvent>) {
    super(token, handlers, { minMs: emsConfig.reconnectMinMs, maxMs: emsConfig.reconnectMaxMs });
  }

  protected url(): string {
    return emsConfig.eventsUrl;
  }
}
