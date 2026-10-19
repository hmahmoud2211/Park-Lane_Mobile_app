/**
 * eWeLink CUBE Open API v2 shapes, as the hub returns them (cubeOS 2.14).
 * Only the fields the app reads are typed.
 */

/** Every response: `error` is 0 on success, else an HTTP-like or 11xxxx code. */
export interface CubeEnvelope<T> {
  error: number;
  data: T;
  message?: string;
}

export interface CubeCapability {
  capability: string;
  permission: string;
  /** The channel, on multi-channel switches. */
  name?: string;
}

export interface CubeDevice {
  serial_number: string;
  name: string;
  manufacturer: string;
  model: string;
  display_category: string;
  capabilities: CubeCapability[];
  protocol?: string;
  state?: {
    power?: { powerState: 'on' | 'off' };
  } & Record<string, unknown>;
  online: boolean;
}

export type CubeCameraProtocol = 'RTSP' | 'ESP32-CAM';

export interface AddCameraRequest {
  name: string;
  /** rtsp://user:pass@host:554/path, or http://host/stream for an ESP32-CAM. */
  streamUrl: string;
  protocol: CubeCameraProtocol;
}
