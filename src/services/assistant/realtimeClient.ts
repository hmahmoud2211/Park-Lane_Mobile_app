import { assistantConfig } from '../../constants/assistantConfig';
import type { RealtimeServerEvent } from './assistant.types';

export interface RealtimeConnectOptions {
  /** Fixed for the whole connection; reconnect to switch residents. */
  residentId?: number | null;
  /** Shows up in the server's logs only. */
  sessionId?: string;
  userId?: string;
}

/** Why the socket closed, already worded for the resident. */
export interface RealtimeCloseInfo {
  /** True when this client hung up; nothing went wrong. */
  intentional: boolean;
  code: number;
  message: string;
}

export interface RealtimeHandlers {
  onEvent: (event: RealtimeServerEvent) => void;
  onClose: (info: RealtimeCloseInfo) => void;
}

/**
 * Past this much unsent audio the network is falling behind; dropping mic
 * frames then keeps the conversation live instead of ever more delayed.
 */
const MAX_BUFFERED_BYTES = 24_000 * 2 * 2;

/**
 * The realtime voice socket (FRONTEND_INTEGRATION.md §5): binary PCM16 up,
 * Realtime events down, plus the camera handshake. Holds no UI state.
 */
export class RealtimeVoiceClient {
  private socket: WebSocket | null = null;
  private closingOnPurpose = false;
  private lastServerError: string | undefined;
  private readonly handlers: RealtimeHandlers;

  constructor(handlers: RealtimeHandlers) {
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect({ residentId, sessionId, userId }: RealtimeConnectOptions = {}): void {
    this.close();
    this.closingOnPurpose = false;
    this.lastServerError = undefined;

    const query = [
      residentId != null ? `resident_id=${encodeURIComponent(String(residentId))}` : '',
      sessionId ? `session_id=${encodeURIComponent(sessionId)}` : '',
      userId ? `user_id=${encodeURIComponent(userId)}` : '',
    ]
      .filter(Boolean)
      .join('&');
    const endpoint = `${assistantConfig.wsBase}${assistantConfig.apiPrefix}/realtime${query ? `?${query}` : ''}`;

    const socket = new WebSocket(endpoint);
    this.socket = socket;

    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') {
        return; // the server only sends JSON text frames
      }
      let event: RealtimeServerEvent;
      try {
        event = JSON.parse(message.data) as RealtimeServerEvent;
      } catch {
        return;
      }
      if (event.type === 'error') {
        this.lastServerError = event.error?.message;
      }
      this.handlers.onEvent(event);
    };

    // A failed handshake fires `error` and then `close`; `close` reports it.
    socket.onerror = () => undefined;

    socket.onclose = (event) => {
      if (this.socket !== socket) {
        return; // a newer connection replaced this one
      }
      this.socket = null;
      this.handlers.onClose({
        intentional: this.closingOnPurpose,
        code: event.code,
        message: this.closeMessage(event.code),
      });
    };
  }

  /** One chunk of PCM16 24 kHz mono, sent as a binary frame. */
  sendAudio(pcm: ArrayBuffer): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || pcm.byteLength === 0) {
      return;
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      return;
    }
    socket.send(pcm);
  }

  /** Sent on every camera toggle, and again after reconnecting. */
  sendCameraStatus(enabled: boolean): void {
    this.sendJson({ type: 'camera_status', enabled });
  }

  /** Base64 JPEG without a `data:` prefix; an empty string means "could not see". */
  sendCameraFrame(callId: string, image: string): void {
    this.sendJson({ type: 'camera_frame', call_id: callId, image });
  }

  /** "Stop talking": the server stops generating; the caller flushes playback. */
  cancelResponse(): void {
    this.sendJson({ type: 'response.cancel' });
  }

  close(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.closingOnPurpose = true;
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'client hang-up');
    }
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private closeMessage(code: number): string {
    if (this.closingOnPurpose) {
      return '';
    }
    switch (code) {
      case 1008:
        return this.lastServerError ?? 'This account could not be verified for voice.';
      case 1011:
        return 'Voice is unavailable on the server right now.';
      case 1006:
        return 'The connection dropped. Check your internet and try again.';
      default:
        return this.lastServerError
          ? `Connection failed: ${this.lastServerError}`
          : 'The voice connection closed unexpectedly.';
    }
  }
}
