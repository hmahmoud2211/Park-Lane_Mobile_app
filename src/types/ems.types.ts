/**
 * The EMS backend's device registry and Alexa integration, as the app sees
 * them (server/src/ems in this repo).
 */

export interface EmsUser {
  id: string;
  email: string;
  name: string;
}

export type SmartDeviceType = 'switch' | 'plug' | 'light' | 'ac' | 'virtual';
export type SmartDevicePower = 'on' | 'off' | 'unknown';

export interface SmartDevice {
  id: string;
  name: string;
  room: string | null;
  type: SmartDeviceType;
  /** `virtual`, `sonoff-lan`, `cube`, or `rethink` for LG appliances. */
  protocol: string;
  /** No hardware behind it: a virtual switch. Always labelled as such. */
  simulated: boolean;
  /** Has settings beyond power, e.g. an AC's mode and set point (see DeviceControls). */
  hasControls: boolean;
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

/** An LG appliance paired with rethink, the backend's local LG bridge (GET /api/lg/appliances). */
export interface LgAppliance {
  /** Rethink's id for the appliance. */
  id: string;
  name: string;
  /** LG's model code, e.g. RAC_056905_WW. */
  model: string | null;
  kind: 'ac';
  online: boolean;
  power: SmartDevicePower;
  /** Already one of this account's devices. */
  added: boolean;
}

export type ControlValue = string | number | boolean | null;

/**
 * One setting or reading beyond power, e.g. an AC's mode, set point, swing,
 * Jet, a timer or its filter hours. The device only lists what it supports.
 * `select`, `number`, `switch` and `button` can be set; `sensor` only reads.
 */
export interface ControlSetting {
  /** e.g. `mode`, `temperature`, `fan_mode`, `swing_mode`, `jet`, `sleeptimer`, `filterused`. */
  key: string;
  kind: 'select' | 'number' | 'switch' | 'button' | 'sensor';
  name: string;
  /** What the device last reported; null when it has not said. */
  value: ControlValue;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit: string | null;
  /** False while the device would ignore it, e.g. Jet outside Cooling. */
  available: boolean;
  /** What it needs to be available, as the manufacturer puts it. */
  requires: string | null;
  description: string | null;
  /** A technical reading most people never need. */
  diagnostic: boolean;
}

/** A device's settings beyond power and its live readings (GET /api/devices/:id/controls). */
export interface DeviceControls {
  online: boolean;
  power: SmartDevicePower;
  /** What it is doing now, e.g. cooling, idle, off; null when it does not say. */
  action: string | null;
  currentTemperature: number | null;
  currentHumidity: number | null;
  settings: ControlSetting[];
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
  | { type: 'controls'; id: string; controls: DeviceControls }
  | { type: 'device_removed'; id: string }
  | { type: 'alexa'; status: AlexaLinkStatus }
  | { type: 'error'; code: string };
