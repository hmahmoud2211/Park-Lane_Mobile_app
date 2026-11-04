/**
 * The home facade's view of a unit, as the app receives it. Home Assistant
 * owns the devices, entities and areas; these types are what the backend
 * maps them to (mapping.ts). The wire types live in shared/contracts, which
 * the app imports too; below are the backend's own additions and Home
 * Assistant's shapes.
 */

import type { HubStatus as ResidentHubStatus } from '../../../shared/contracts/home.ts';

export type {
  Capability,
  CapabilityType,
  CommandRequest,
  Device,
  DeviceKind,
  Home,
  Room,
  SensorReading,
} from '../../../shared/contracts/home.ts';

/** The hub as operators see it: `failed` (setup failed) is reported to residents as `provisioning`. */
export type HubStatus = ResidentHubStatus | 'failed';

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
