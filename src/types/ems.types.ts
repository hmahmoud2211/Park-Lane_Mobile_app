/**
 * The EMS backend's device registry and Alexa integration, as the app sees
 * them (server/src/ems in this repo).
 */

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
  /** `virtual` or `sonoff-lan` today. */
  protocol: string;
  /** No hardware behind it: a virtual switch. Always labelled as such. */
  simulated: boolean;
  online: boolean;
  /** The last state the device itself confirmed. */
  power: SmartDevicePower;
  /** A command in flight, from this phone, another one, or Alexa. */
  pendingPower: 'on' | 'off' | null;
  alexaEnabled: boolean;
  /** What Alexa switches when no device is named. */
  isDefault: boolean;
  lastSeen: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AlexaLinkStatus = 'linked' | 'unlinked' | 'failed' | 'expired';

export interface AlexaStatus {
  /** False until the backend has the skill's Amazon settings. */
  configured: boolean;
  status: AlexaLinkStatus;
  via: 'app' | 'alexa' | null;
  linkedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  skillStage: string;
}

export type RealtimeState = 'offline' | 'connecting' | 'live';

export type EmsEvent =
  | { type: 'ready' }
  | { type: 'device'; device: SmartDevice }
  | { type: 'device_removed'; id: string }
  | { type: 'alexa'; status: AlexaLinkStatus }
  | { type: 'error'; code: string };
