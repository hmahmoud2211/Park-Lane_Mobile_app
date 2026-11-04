import type { Capability, Device, DeviceKind, HaEntity, HaState, Registries, Room, SensorReading } from './types.ts';

/**
 * Home Assistant's registries and states as Park-Lane devices. Pure, so it
 * can be tested on fixtures: hubs.ts calls it whenever something changes.
 *
 * Entities are grouped by their device; an entity without one becomes its
 * own device (`e.<entity_id>`). Hidden, disabled and configuration entities
 * are left out, and so are devices with nothing the app can show.
 *
 * Feature bits are Home Assistant's own (see each domain's const.py in IOT/core).
 */

const CLIMATE_TARGET_TEMPERATURE = 1;
const CLIMATE_FAN_MODE = 8;
const COVER_SET_POSITION = 4;
const COVER_STOP = 8;
const FAN_SET_SPEED = 1;
const FAN_PRESET_MODE = 8;
const MEDIA_VOLUME_SET = 4;
const MEDIA_VOLUME_MUTE = 8;
const MEDIA_TURN_ON = 128;
const MEDIA_TURN_OFF = 256;
const MEDIA_SELECT_SOURCE = 2048;

const COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);
const SENSOR_DOMAINS = new Set(['sensor', 'binary_sensor']);
/** Which domain decides a device's kind when it has several, most specific first. */
const KIND_ORDER: readonly [string, DeviceKind][] = [
  ['climate', 'climate'],
  ['lock', 'lock'],
  ['cover', 'cover'],
  ['media_player', 'media'],
  ['fan', 'fan'],
  ['light', 'light'],
  ['switch', 'switch'],
  ['input_boolean', 'switch'],
];

const UNAVAILABLE = new Set(['unavailable']);

export const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
const features = (state: HaState) => num(state.attributes.supported_features) ?? 0;

function power(state: HaState): 'on' | 'off' | 'unknown' {
  return state.state === 'on' ? 'on' : state.state === 'off' ? 'off' : 'unknown';
}

export function entityLabel(entity: HaEntity, state: HaState | undefined): string {
  return entity.name ?? entity.original_name ?? str(state?.attributes.friendly_name) ?? entity.entity_id;
}

/** What the app can do with one entity. */
export function capabilitiesOf(entityId: string, state: HaState, label: string): Capability[] {
  const base = { entityId, label };
  const attrs = state.attributes;
  switch (domainOf(entityId)) {
    case 'light': {
      const modes = strings(attrs.supported_color_modes);
      const caps: Capability[] = [{ ...base, type: 'power', value: power(state) }];
      if (modes.some((mode) => mode !== 'onoff')) {
        const brightness = num(attrs.brightness);
        caps.push({ ...base, type: 'brightness', value: brightness === null ? null : Math.round((brightness / 255) * 100) });
      }
      if (modes.includes('color_temp')) {
        caps.push({
          ...base,
          type: 'color_temp',
          value: num(attrs.color_temp_kelvin),
          min: num(attrs.min_color_temp_kelvin) ?? 2000,
          max: num(attrs.max_color_temp_kelvin) ?? 6500,
        });
      }
      if (modes.some((mode) => COLOR_MODES.has(mode))) {
        const hs = Array.isArray(attrs.hs_color) ? attrs.hs_color : null;
        caps.push({ ...base, type: 'color', value: hs && num(hs[0]) !== null ? { h: hs[0], s: hs[1] } : null });
      }
      return caps;
    }
    case 'switch':
    case 'input_boolean':
      return [{ ...base, type: 'power', value: power(state) }];
    case 'fan': {
      const caps: Capability[] = [{ ...base, type: 'power', value: power(state) }];
      if (features(state) & (FAN_SET_SPEED | FAN_PRESET_MODE)) {
        caps.push({
          ...base,
          type: 'fan',
          percentage: num(attrs.percentage),
          presetMode: str(attrs.preset_mode),
          presetModes: strings(attrs.preset_modes),
        });
      }
      return caps;
    }
    case 'cover':
      return [
        {
          ...base,
          type: 'cover',
          position: num(attrs.current_position),
          state: state.state,
          canPosition: Boolean(features(state) & COVER_SET_POSITION),
          canStop: Boolean(features(state) & COVER_STOP),
        },
      ];
    case 'climate':
      return [
        {
          ...base,
          type: 'climate',
          current: num(attrs.current_temperature),
          target: features(state) & CLIMATE_TARGET_TEMPERATURE ? num(attrs.temperature) : null,
          min: num(attrs.min_temp) ?? 7,
          max: num(attrs.max_temp) ?? 35,
          step: num(attrs.target_temp_step) ?? 0.5,
          unit: str(attrs.temperature_unit) ?? '°C',
          mode: state.state,
          modes: strings(attrs.hvac_modes),
          fanMode: features(state) & CLIMATE_FAN_MODE ? str(attrs.fan_mode) : null,
          fanModes: features(state) & CLIMATE_FAN_MODE ? strings(attrs.fan_modes) : [],
        },
      ];
    case 'lock':
      return [{ ...base, type: 'lock', value: state.state }];
    case 'media_player': {
      const bits = features(state);
      const caps: Capability[] = [];
      if (bits & (MEDIA_TURN_ON | MEDIA_TURN_OFF)) {
        caps.push({ ...base, type: 'power', value: state.state === 'off' ? 'off' : UNAVAILABLE.has(state.state) ? 'unknown' : 'on' });
      }
      caps.push({
        ...base,
        type: 'media',
        state: state.state,
        volume: bits & MEDIA_VOLUME_SET ? num(attrs.volume_level) : null,
        muted: bits & MEDIA_VOLUME_MUTE ? (typeof attrs.is_volume_muted === 'boolean' ? attrs.is_volume_muted : null) : null,
        title: str(attrs.media_title),
        source: bits & MEDIA_SELECT_SOURCE ? str(attrs.source) : null,
        sources: bits & MEDIA_SELECT_SOURCE ? strings(attrs.source_list) : [],
      });
      return caps;
    }
    case 'button':
      return [{ ...base, type: 'press' }];
    default:
      return [];
  }
}

function sensorOf(entityId: string, state: HaState, label: string): SensorReading {
  return {
    entityId,
    label,
    value: state.state,
    unit: str(state.attributes.unit_of_measurement),
    deviceClass: str(state.attributes.device_class),
  };
}

function kindOf(entityIds: readonly string[], states: ReadonlyMap<string, HaState>): DeviceKind {
  const domains = new Set(entityIds.map(domainOf));
  for (const [domain, kind] of KIND_ORDER) {
    if (domains.has(domain)) {
      if (kind === 'switch') {
        const outlet = entityIds.some(
          (id) => domainOf(id) === domain && states.get(id)?.attributes.device_class === 'outlet',
        );
        return outlet ? 'plug' : 'switch';
      }
      return kind;
    }
  }
  return [...domains].every((domain) => SENSOR_DOMAINS.has(domain)) ? 'sensor' : 'other';
}

/** Entities the app shows, grouped by the device id the app uses. */
function groupEntities(registries: Registries, states: ReadonlyMap<string, HaState>): Map<string, HaEntity[]> {
  const groups = new Map<string, HaEntity[]>();
  for (const entity of registries.entities.values()) {
    if (entity.disabled_by || entity.hidden_by || entity.entity_category === 'config' || !states.has(entity.entity_id)) {
      continue;
    }
    const device = entity.device_id ? registries.devices.get(entity.device_id) : undefined;
    if (device && (device.disabled_by || device.entry_type === 'service')) {
      continue;
    }
    const id = device ? device.id : `e.${entity.entity_id}`;
    groups.set(id, [...(groups.get(id) ?? []), entity]);
  }
  return groups;
}

export function toDevices(registries: Registries, states: ReadonlyMap<string, HaState>): Device[] {
  const devices: Device[] = [];
  for (const [id, entities] of groupEntities(registries, states)) {
    const haDevice = id.startsWith('e.') ? undefined : registries.devices.get(id);
    const capabilities: Capability[] = [];
    const sensors: SensorReading[] = [];
    const primary: string[] = [];

    for (const entity of entities) {
      const state = states.get(entity.entity_id) as HaState;
      const label = entityLabel(entity, state);
      if (SENSOR_DOMAINS.has(domainOf(entity.entity_id))) {
        sensors.push(sensorOf(entity.entity_id, state, label));
        continue;
      }
      // Diagnostic controls (restart buttons, firmware toggles) are not for residents.
      if (entity.entity_category === 'diagnostic') {
        continue;
      }
      const caps = capabilitiesOf(entity.entity_id, state, label);
      if (caps.length > 0) {
        capabilities.push(...caps);
        primary.push(entity.entity_id);
      }
    }
    if (capabilities.length === 0 && sensors.length === 0) {
      continue;
    }

    const shown = primary.length > 0 ? primary : sensors.map((sensor) => sensor.entityId);
    const changed = shown.map((entityId) => states.get(entityId)?.lastChanged ?? null).filter((at) => at !== null);
    const lone = entities[0];
    const areaId = haDevice ? haDevice.area_id : lone.area_id;
    devices.push({
      id,
      name: haDevice
        ? (haDevice.name_by_user ?? haDevice.name ?? entityLabel(lone, states.get(lone.entity_id)))
        : entityLabel(lone, states.get(lone.entity_id)),
      roomId: areaId,
      room: areaId ? (registries.areas.get(areaId)?.name ?? null) : null,
      kind: kindOf(shown, states),
      manufacturer: haDevice?.manufacturer ?? null,
      model: haDevice?.model ?? null,
      integration: lone.platform,
      accountId: haDevice?.config_entry_id ?? lone.config_entry_id,
      online: shown.some((entityId) => !UNAVAILABLE.has(states.get(entityId)?.state ?? 'unavailable')),
      capabilities,
      sensors,
      pending: null,
      lastChanged: changed.length > 0 ? Math.max(...changed) : null,
      lastError: null,
    });
  }
  return devices.sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿') || a.name.localeCompare(b.name));
}

export function toRooms(registries: Registries, devices: readonly Device[]): Room[] {
  return [...registries.areas.values()]
    .map((area) => ({
      id: area.area_id,
      name: area.name,
      icon: area.icon,
      deviceCount: devices.filter((device) => device.roomId === area.area_id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
