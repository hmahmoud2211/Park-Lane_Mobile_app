/**
 * The home facade's view of a unit, as the app receives it. Home Assistant
 * owns the devices, entities and areas; these types are what the backend
 * maps them to (mapping.ts), mirrored by the app in src/types/home.types.ts.
 */

export type DeviceKind = 'light' | 'switch' | 'plug' | 'climate' | 'cover' | 'lock' | 'fan' | 'media' | 'sensor' | 'other';

interface CapabilityBase {
  /** The Home Assistant entity the capability belongs to; commands name it. */
  entityId: string;
  label: string;
}

export type Capability = CapabilityBase &
  (
    | { type: 'power'; value: 'on' | 'off' | 'unknown' }
    | { type: 'brightness'; value: number | null }
    | { type: 'color_temp'; value: number | null; min: number; max: number }
    | { type: 'color'; value: { h: number; s: number } | null }
    | {
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
      }
    | { type: 'cover'; position: number | null; state: string; canPosition: boolean; canStop: boolean }
    | { type: 'lock'; value: string }
    | { type: 'fan'; percentage: number | null; presetMode: string | null; presetModes: string[] }
    | {
        type: 'media';
        state: string;
        volume: number | null;
        muted: boolean | null;
        title: string | null;
        source: string | null;
        sources: string[];
      }
    | { type: 'press' }
  );

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
  icon: string | null;
  deviceCount: number;
}

export type HubStatus = 'provisioning' | 'online' | 'offline' | 'auth_failed' | 'failed';

/** What the app may ask a device to do; commands.ts checks it against the allowlist. */
export interface CommandRequest {
  capability: CapabilityType;
  action: string;
  value?: unknown;
  entityId?: string;
}

// ---- Home Assistant's own shapes (only the fields the facade reads) ------------------------

export interface HaArea {
  area_id: string;
  name: string;
  icon: string | null;
}

export interface HaDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  config_entry_id: string | null;
  disabled_by: string | null;
  entry_type: string | null;
}

export interface HaEntity {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  config_entry_id: string | null;
  platform: string;
  name: string | null;
  original_name: string | null;
  entity_category: string | null;
  disabled_by: string | null;
  hidden_by: string | null;
}

export interface HaState {
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: number | null;
}

export interface Registries {
  areas: Map<string, HaArea>;
  devices: Map<string, HaDevice>;
  entities: Map<string, HaEntity>;
}
