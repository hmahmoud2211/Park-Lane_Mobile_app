/** The EMS backend's accounts and devices, as the app sees them (server/ in this repo). */

export interface EmsUser {
  id: string;
  email: string;
  name: string;
}

export type SmartDeviceType = 'switch' | 'plug' | 'light' | 'virtual';
export type SmartDevicePower = 'on' | 'off' | 'unknown';

export interface SmartDevice {
  id: string;
  name: string;
  room: string | null;
  type: SmartDeviceType;
  protocol: string;
  /** No hardware behind it. Always labelled as such. */
  simulated: boolean;
  online: boolean;
  /** The last state the device itself confirmed. */
  power: SmartDevicePower;
  /** A command in flight, from this phone or another one. */
  pendingPower: 'on' | 'off' | null;
  lastSeen: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RealtimeState = 'offline' | 'connecting' | 'live';

export type EmsEvent =
  | { type: 'ready' }
  | { type: 'device'; device: SmartDevice }
  | { type: 'device_removed'; id: string }
  | { type: 'error'; code: string };
