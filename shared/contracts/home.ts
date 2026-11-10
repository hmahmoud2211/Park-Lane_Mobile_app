/**
 * The resident's home as the device backend serves it: GET /api/home, /api/devices,
 * /api/rooms. Home Assistant owns the devices, entities and areas; these are what the
 * backend maps them to (backend/src/ha/mapping.ts).
 */

export type DeviceKind = 'light' | 'switch' | 'plug' | 'climate' | 'cover' | 'lock' | 'fan' | 'media' | 'sensor' | 'other';

export interface CapabilityBase {
  /** The Home Assistant entity the capability belongs to; commands name it. A device can have several. */
  entityId: string;
  label: string;
}

export type PowerCapability = CapabilityBase & { type: 'power'; value: 'on' | 'off' | 'unknown' };
export type BrightnessCapability = CapabilityBase & { type: 'brightness'; value: number | null };
export type ColorTempCapability = CapabilityBase & { type: 'color_temp'; value: number | null; min: number; max: number };
export type ColorCapability = CapabilityBase & { type: 'color'; value: { h: number; s: number } | null };
export type ClimateCapability = CapabilityBase & {
  type: 'climate';
  current: number | null;
  target: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  mode: string;
  modes: string[];
  fanMode: string | null;
  fanModes: string[];
};
export type CoverCapability = CapabilityBase & {
  type: 'cover';
  position: number | null;
  state: string;
  canPosition: boolean;
  canStop: boolean;
};
export type LockCapability = CapabilityBase & { type: 'lock'; value: string };
export type FanCapability = CapabilityBase & {
  type: 'fan';
  percentage: number | null;
  presetMode: string | null;
  presetModes: string[];
};
export type MediaCapability = CapabilityBase & {
  type: 'media';
  state: string;
  volume: number | null;
  muted: boolean | null;
  title: string | null;
  source: string | null;
  sources: string[];
};
export type PressCapability = CapabilityBase & { type: 'press' };

export type Capability =
  | PowerCapability
  | BrightnessCapability
  | ColorTempCapability
  | ColorCapability
  | ClimateCapability
  | CoverCapability
  | LockCapability
  | FanCapability
  | MediaCapability
  | PressCapability;

export type CapabilityType = Capability['type'];

export interface SensorReading {
  entityId: string;
  label: string;
  value: string;
  unit: string | null;
  deviceClass: string | null;
}

export interface Device {
  /** The Home Assistant device id, or `e.<entity_id>` for an entity without a device. */
  id: string;
  name: string;
  roomId: string | null;
  room: string | null;
  kind: DeviceKind;
  manufacturer: string | null;
  model: string | null;
  /** The integration that provides it, e.g. `tuya`. */
  integration: string | null;
  /** The linked account (Home Assistant config entry) it came from. */
  accountId: string | null;
  online: boolean;
  capabilities: Capability[];
  sensors: SensorReading[];
  /** A command in flight, from this phone or another one. */
  pending: { entityId: string; capability: CapabilityType; action: string } | null;
  /** Seconds since the epoch, as Home Assistant reports them. */
  lastChanged: number | null;
  lastError: string | null;
}

export interface Room {
  id: string;
  name: string;
  /** Home Assistant's icon name, e.g. `mdi:sofa`. */
  icon: string | null;
  deviceCount: number;
}

/**
 * A unit's hub as residents see it. The backend also knows `failed` (setup failed), which
 * it reports as `provisioning`: that is the operators' problem.
 */
export type HubStatus = 'provisioning' | 'online' | 'offline' | 'auth_failed';

/** GET /api/home */
export interface Home {
  unit: { id: string; name: string; building: string | null };
  hub: { status: HubStatus; haVersion: string | null; lastSeen: string | null };
  rooms: Room[];
  deviceCount: number;
}

/** POST /api/devices/:id/commands; the backend checks it against its allowlist (backend/src/ha/commands.ts). */
export interface CommandRequest {
  capability: CapabilityType;
  action: string;
  value?: unknown;
  entityId?: string;
}

/** A scene in the apartment's Home Assistant (the installer makes them): GET /api/home/scenes. */
export interface HomeScene {
  id: string;
  name: string;
  /** Home Assistant's icon name (e.g. "mdi:movie"), if it has one. */
  icon: string | null;
  /** When it last ran, if known. */
  lastActivated: string | null;
}

/** An automation in the apartment's Home Assistant: GET /api/home/automations. */
export interface HomeAutomation {
  id: string;
  name: string;
  enabled: boolean;
  lastTriggered: string | null;
}
