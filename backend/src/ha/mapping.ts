import type { Capability, Device, DeviceKind, HaEntity, HaState, Registries, Room, SensorReading } from './types.ts';

/**
 * Home Assistant's registries and states as Park-Lane devices. Pure, so it
 * can be tested on fixtures: hubs.ts calls it whenever something changes.
 *
 * Entities are grouped by their device; an entity without one becomes its
 * own device (`e.<entity_id>`). Hidden, disabled and diagnostic controls are
 * left out, and so are devices with nothing the app can show. Configuration
 * entities (child lock, power-on behaviour…) are kept, with `advanced: true`
 * on their capabilities, after the everyday ones; they never decide a
 * device's kind.
 *
 * Every capability reports only what the entity says it can do: a `can…`
 * flag that is false, a null value or an empty list means "not on this
 * device", and commands.ts refuses the matching action.
 *
 * Feature bits are Home Assistant's own (each domain's `<Domain>EntityFeature`
 * in Home Assistant core, homeassistant/components/<domain>/const.py).
 */

const CLIMATE = { TARGET_TEMPERATURE: 1, TARGET_TEMPERATURE_RANGE: 2, TARGET_HUMIDITY: 4, FAN_MODE: 8, PRESET_MODE: 16, SWING_MODE: 32 };
const COVER = { SET_POSITION: 4, STOP: 8, OPEN_TILT: 16, CLOSE_TILT: 32, STOP_TILT: 64, SET_TILT_POSITION: 128 };
const FAN = { SET_SPEED: 1, OSCILLATE: 2, DIRECTION: 4, PRESET_MODE: 8 };
const MEDIA = {
  PAUSE: 1,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  REPEAT_SET: 262144,
};
const LIGHT_EFFECT = 4;
const LOCK_OPEN = 1;
/** BATTERY (64) is gone from current Home Assistant (the battery is its own sensor there), but older integrations still set it. */
const VACUUM = { PAUSE: 4, STOP: 8, RETURN_HOME: 16, FAN_SPEED: 32, BATTERY: 64, LOCATE: 512, CLEAN_SPOT: 1024 };
const HUMIDIFIER_MODES = 1;
const WATER_HEATER = { TARGET_TEMPERATURE: 1, OPERATION_MODE: 2, AWAY_MODE: 4, ON_OFF: 8 };
const VALVE = { SET_POSITION: 4, STOP: 8 };
const ALARM_MODES: readonly [number, 'home' | 'away' | 'night' | 'vacation' | 'custom_bypass'][] = [
  [1, 'home'],
  [2, 'away'],
  [4, 'night'],
  [32, 'vacation'],
  [16, 'custom_bypass'],
];
const MOWER = { PAUSE: 2, DOCK: 4 };
const REMOTE_ACTIVITY = 4;

const COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);
const SENSOR_DOMAINS = new Set(['sensor', 'binary_sensor']);
/** Which domain decides a device's kind when it has several, most specific first. */
const KIND_ORDER: readonly [string, DeviceKind][] = [
  ['alarm_control_panel', 'alarm'],
  ['climate', 'climate'],
  ['water_heater', 'water_heater'],
  ['humidifier', 'humidifier'],
  ['vacuum', 'vacuum'],
  ['lawn_mower', 'mower'],
  ['lock', 'lock'],
  ['valve', 'valve'],
  ['cover', 'cover'],
  ['media_player', 'media'],
  ['fan', 'fan'],
  ['light', 'light'],
  ['switch', 'switch'],
  ['input_boolean', 'switch'],
];

const UNAVAILABLE = new Set(['unavailable']);
const REPEAT_MODES = new Set(['off', 'one', 'all']);

export const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
const features = (state: HaState) => num(state.attributes.supported_features) ?? 0;
/** A number entity's state is its value as text ("21.5"); unknown and unavailable are null. */
const numericState = (state: HaState): number | null => {
  const value = state.state.trim() === '' ? NaN : Number(state.state);
  return Number.isFinite(value) ? value : null;
};

function power(state: HaState): 'on' | 'off' | 'unknown' {
  return state.state === 'on' ? 'on' : state.state === 'off' ? 'off' : 'unknown';
}

/** On unless it says off, for entities whose state is an activity or a mode (media players, water heaters). */
function poweredUnlessOff(state: HaState): 'on' | 'off' | 'unknown' {
  return state.state === 'off' ? 'off' : UNAVAILABLE.has(state.state) || state.state === 'unknown' ? 'unknown' : 'on';
}

export function entityLabel(entity: HaEntity, state: HaState | undefined): string {
  return entity.name ?? entity.original_name ?? str(state?.attributes.friendly_name) ?? entity.entity_id;
}

/** What the app can do with one entity. */
export function capabilitiesOf(entityId: string, state: HaState, label: string): Capability[] {
  const base = { entityId, label };
  const attrs = state.attributes;
  const bits = features(state);
  const has = (bit: number) => (bits & bit) !== 0;
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
      if (has(LIGHT_EFFECT)) {
        caps.push({ ...base, label: 'Effect', type: 'option', role: 'effect', value: str(attrs.effect), options: strings(attrs.effect_list) });
      }
      return caps;
    }
    case 'switch':
    case 'input_boolean':
    case 'siren':
      return [{ ...base, type: 'power', value: power(state) }];
    case 'remote': {
      const caps: Capability[] = [{ ...base, type: 'power', value: power(state) }];
      if (has(REMOTE_ACTIVITY)) {
        caps.push({
          ...base,
          label: 'Activity',
          type: 'option',
          role: 'activity',
          value: str(attrs.current_activity),
          options: strings(attrs.activity_list),
        });
      }
      return caps;
    }
    case 'fan': {
      const caps: Capability[] = [{ ...base, type: 'power', value: power(state) }];
      if (has(FAN.SET_SPEED | FAN.OSCILLATE | FAN.DIRECTION | FAN.PRESET_MODE)) {
        caps.push({
          ...base,
          type: 'fan',
          percentage: has(FAN.SET_SPEED) ? num(attrs.percentage) : null,
          percentageStep: num(attrs.percentage_step) ?? 1,
          presetMode: has(FAN.PRESET_MODE) ? str(attrs.preset_mode) : null,
          presetModes: has(FAN.PRESET_MODE) ? strings(attrs.preset_modes) : [],
          oscillating: has(FAN.OSCILLATE) ? attrs.oscillating === true : null,
          direction: has(FAN.DIRECTION) ? (attrs.direction === 'reverse' ? 'reverse' : 'forward') : null,
        });
      }
      return caps;
    }
    case 'cover': {
      const canTilt = has(COVER.OPEN_TILT) || has(COVER.CLOSE_TILT);
      const canSetTilt = has(COVER.SET_TILT_POSITION);
      return [
        {
          ...base,
          type: 'cover',
          position: num(attrs.current_position),
          state: state.state,
          canPosition: has(COVER.SET_POSITION),
          canStop: has(COVER.STOP),
          tilt: canTilt || canSetTilt || has(COVER.STOP_TILT) ? num(attrs.current_tilt_position) : null,
          canTilt,
          canSetTilt,
        },
      ];
    }
    case 'climate':
      return [
        {
          ...base,
          type: 'climate',
          current: num(attrs.current_temperature),
          target: has(CLIMATE.TARGET_TEMPERATURE) ? num(attrs.temperature) : null,
          targetLow: has(CLIMATE.TARGET_TEMPERATURE_RANGE) ? num(attrs.target_temp_low) : null,
          targetHigh: has(CLIMATE.TARGET_TEMPERATURE_RANGE) ? num(attrs.target_temp_high) : null,
          min: num(attrs.min_temp) ?? 7,
          max: num(attrs.max_temp) ?? 35,
          step: num(attrs.target_temp_step) ?? 0.5,
          unit: str(attrs.temperature_unit) ?? '°C',
          mode: state.state,
          modes: strings(attrs.hvac_modes),
          fanMode: has(CLIMATE.FAN_MODE) ? str(attrs.fan_mode) : null,
          fanModes: has(CLIMATE.FAN_MODE) ? strings(attrs.fan_modes) : [],
          presetMode: has(CLIMATE.PRESET_MODE) ? str(attrs.preset_mode) : null,
          presetModes: has(CLIMATE.PRESET_MODE) ? strings(attrs.preset_modes) : [],
          swingMode: has(CLIMATE.SWING_MODE) ? str(attrs.swing_mode) : null,
          swingModes: has(CLIMATE.SWING_MODE) ? strings(attrs.swing_modes) : [],
          currentHumidity: num(attrs.current_humidity),
          targetHumidity: has(CLIMATE.TARGET_HUMIDITY) ? num(attrs.humidity) : null,
          // Home Assistant's defaults (climate/const.py DEFAULT_MIN_HUMIDITY / DEFAULT_MAX_HUMIDITY).
          minHumidity: num(attrs.min_humidity) ?? 30,
          maxHumidity: num(attrs.max_humidity) ?? 99,
        },
      ];
    case 'lock':
      return [{ ...base, type: 'lock', value: state.state, canOpen: has(LOCK_OPEN) }];
    case 'media_player': {
      const caps: Capability[] = [];
      if (has(MEDIA.TURN_ON | MEDIA.TURN_OFF)) {
        caps.push({ ...base, type: 'power', value: poweredUnlessOff(state) });
      }
      const repeat = str(attrs.repeat);
      caps.push({
        ...base,
        type: 'media',
        state: state.state,
        volume: has(MEDIA.VOLUME_SET) ? num(attrs.volume_level) : null,
        muted: has(MEDIA.VOLUME_MUTE) ? (typeof attrs.is_volume_muted === 'boolean' ? attrs.is_volume_muted : null) : null,
        title: str(attrs.media_title),
        artist: str(attrs.media_artist),
        source: has(MEDIA.SELECT_SOURCE) ? str(attrs.source) : null,
        sources: has(MEDIA.SELECT_SOURCE) ? strings(attrs.source_list) : [],
        soundMode: has(MEDIA.SELECT_SOUND_MODE) ? str(attrs.sound_mode) : null,
        soundModes: has(MEDIA.SELECT_SOUND_MODE) ? strings(attrs.sound_mode_list) : [],
        // A player that is off reports no shuffle or repeat; it still can set them.
        shuffle: has(MEDIA.SHUFFLE_SET) ? attrs.shuffle === true : null,
        repeat: has(MEDIA.REPEAT_SET) ? (repeat && REPEAT_MODES.has(repeat) ? (repeat as 'off' | 'one' | 'all') : 'off') : null,
        canPlay: has(MEDIA.PLAY),
        canPause: has(MEDIA.PAUSE),
        canStop: has(MEDIA.STOP),
        canNext: has(MEDIA.NEXT_TRACK),
        canPrevious: has(MEDIA.PREVIOUS_TRACK),
        // Home Assistant runs volume_up / volume_down for either feature (it steps a settable volume itself).
        canVolumeStep: has(MEDIA.VOLUME_STEP | MEDIA.VOLUME_SET),
      });
      return caps;
    }
    case 'button':
    case 'input_button':
      return [{ ...base, type: 'press' }];
    case 'select':
    case 'input_select': {
      const options = strings(attrs.options);
      return [{ ...base, type: 'option', role: 'setting', value: options.includes(state.state) ? state.state : null, options }];
    }
    case 'number':
    case 'input_number': {
      const step = num(attrs.step);
      return [
        {
          ...base,
          type: 'number',
          value: numericState(state),
          // Home Assistant's defaults for a number entity (number/const.py).
          min: num(attrs.min) ?? 0,
          max: num(attrs.max) ?? 100,
          step: step !== null && step > 0 ? step : 1,
          unit: str(attrs.unit_of_measurement),
        },
      ];
    }
    case 'vacuum':
      return [
        {
          ...base,
          type: 'vacuum',
          state: state.state,
          battery: has(VACUUM.BATTERY) ? num(attrs.battery_level) : null,
          fanSpeed: has(VACUUM.FAN_SPEED) ? str(attrs.fan_speed) : null,
          fanSpeeds: has(VACUUM.FAN_SPEED) ? strings(attrs.fan_speed_list) : [],
          canPause: has(VACUUM.PAUSE),
          canStop: has(VACUUM.STOP),
          canReturn: has(VACUUM.RETURN_HOME),
          canLocate: has(VACUUM.LOCATE),
          canSpot: has(VACUUM.CLEAN_SPOT),
        },
      ];
    case 'humidifier':
      return [
        { ...base, type: 'power', value: power(state) },
        {
          ...base,
          type: 'humidifier',
          current: num(attrs.current_humidity),
          target: num(attrs.humidity),
          // Home Assistant's defaults (humidifier/const.py DEFAULT_MIN_HUMIDITY / DEFAULT_MAX_HUMIDITY).
          min: num(attrs.min_humidity) ?? 0,
          max: num(attrs.max_humidity) ?? 100,
          mode: has(HUMIDIFIER_MODES) ? str(attrs.mode) : null,
          modes: has(HUMIDIFIER_MODES) ? strings(attrs.available_modes) : [],
        },
      ];
    case 'water_heater': {
      const caps: Capability[] = [];
      if (has(WATER_HEATER.ON_OFF)) {
        caps.push({ ...base, type: 'power', value: poweredUnlessOff(state) });
      }
      caps.push({
        ...base,
        type: 'water_heater',
        current: num(attrs.current_temperature),
        target: has(WATER_HEATER.TARGET_TEMPERATURE) ? num(attrs.temperature) : null,
        // Home Assistant's defaults are 110–140 °F (water_heater/const.py), about 43–60 °C.
        min: num(attrs.min_temp) ?? 43,
        max: num(attrs.max_temp) ?? 60,
        unit: str(attrs.temperature_unit) ?? '°C',
        mode: has(WATER_HEATER.OPERATION_MODE) ? str(attrs.operation_mode) : null,
        modes: has(WATER_HEATER.OPERATION_MODE) ? strings(attrs.operation_list) : [],
        away: has(WATER_HEATER.AWAY_MODE) ? attrs.away_mode === 'on' : null,
      });
      return caps;
    }
    case 'valve':
      return [
        {
          ...base,
          type: 'valve',
          position: num(attrs.current_position),
          state: state.state,
          canPosition: has(VALVE.SET_POSITION),
          canStop: has(VALVE.STOP),
        },
      ];
    case 'alarm_control_panel':
      return [
        {
          ...base,
          type: 'alarm',
          state: state.state,
          modes: ALARM_MODES.filter(([bit]) => has(bit)).map(([, mode]) => mode),
          // Home Assistant reports code_format null when the panel takes no code. Some panels want it only to disarm
          // (code_arm_required false); commands.ts then lets arming go without it and Home Assistant decides.
          codeRequired: typeof attrs.code_format === 'string',
        },
      ];
    case 'lawn_mower':
      return [{ ...base, type: 'mower', state: state.state, canPause: has(MOWER.PAUSE), canDock: has(MOWER.DOCK) }];
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
  return domains.size > 0 && [...domains].every((domain) => SENSOR_DOMAINS.has(domain)) ? 'sensor' : 'other';
}

/** Entities the app shows, grouped by the device id the app uses. */
function groupEntities(registries: Registries, states: ReadonlyMap<string, HaState>): Map<string, HaEntity[]> {
  const groups = new Map<string, HaEntity[]>();
  for (const entity of registries.entities.values()) {
    if (entity.disabled_by || entity.hidden_by || !states.has(entity.entity_id)) {
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
    const settings: Capability[] = [];
    const sensors: SensorReading[] = [];
    const primary: string[] = [];
    const advanced: string[] = [];

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
      if (caps.length === 0) {
        continue;
      }
      if (entity.entity_category === 'config') {
        settings.push(...caps.map((capability) => ({ ...capability, advanced: true })));
        advanced.push(entity.entity_id);
      } else {
        capabilities.push(...caps);
        primary.push(entity.entity_id);
      }
    }
    if (capabilities.length === 0 && settings.length === 0 && sensors.length === 0) {
      continue;
    }

    // The kind comes from the everyday controls (else the sensors); settings alone make it `other`.
    const typed = primary.length > 0 ? primary : sensors.map((sensor) => sensor.entityId);
    const shown = typed.length > 0 ? typed : advanced;
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
      kind: kindOf(typed, states),
      manufacturer: haDevice?.manufacturer ?? null,
      model: haDevice?.model ?? null,
      integration: lone.platform,
      accountId: haDevice?.config_entry_id ?? lone.config_entry_id,
      online: shown.some((entityId) => !UNAVAILABLE.has(states.get(entityId)?.state ?? 'unavailable')),
      capabilities: [...capabilities, ...settings],
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
