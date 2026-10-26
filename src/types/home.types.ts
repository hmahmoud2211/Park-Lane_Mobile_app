/**
 * The resident's home as the EMS backend serves it, from the unit's Home
 * Assistant. Mirrors server/src/ha/types.ts: change both together.
 */

export type DeviceKind = 'light' | 'switch' | 'plug' | 'climate' | 'cover' | 'lock' | 'fan' | 'media' | 'sensor' | 'other';

interface CapabilityBase {
  /** The entity commands are sent to; a device can have several. */
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
  id: string;
  name: string;
  roomId: string | null;
  room: string | null;
  kind: DeviceKind;
  manufacturer: string | null;
  model: string | null;
  integration: string | null;
  accountId: string | null;
  online: boolean;
  capabilities: Capability[];
  sensors: SensorReading[];
  /** A command in flight, from this phone or another one. */
  pending: { entityId: string; capability: CapabilityType; action: string } | null;
  /** Seconds since the epoch. */
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

export type HubStatus = 'provisioning' | 'online' | 'offline' | 'auth_failed';

export interface Home {
  unit: { id: string; name: string; building: string | null };
  hub: { status: HubStatus; haVersion: string | null; lastSeen: string | null };
  rooms: Room[];
  deviceCount: number;
}

export interface Command {
  capability: CapabilityType;
  action: string;
  value?: unknown;
  entityId?: string;
}
