/**
 * The resident's home as the device backend serves it: GET /api/home, /api/devices,
 * /api/rooms. Home Assistant owns the devices, entities and areas; these are what the
 * backend maps them to (backend/src/ha/mapping.ts).
 *
 * An assistant token also gets the devices on the unit's CUBE gateway, which the
 * backend reaches through the relay (backend/src/gateway/mapping.ts): their ids start
 * with `gw.`, and a capability's `entityId` is the gateway's capability key. The app
 * reaches its gateway itself, so its own session never sees them here.
 */

export type DeviceKind =
  | 'light'
  | 'switch'
  | 'plug'
  | 'climate'
  | 'cover'
  | 'lock'
  | 'fan'
  | 'media'
  | 'vacuum'
  | 'humidifier'
  | 'water_heater'
  | 'valve'
  | 'alarm'
  | 'mower'
  | 'sensor'
  | 'other';

export interface CapabilityBase {
  /** The Home Assistant entity the capability belongs to; commands name it. A device can have several. */
  entityId: string;
  label: string;
  /**
   * A device setting rather than an everyday control: Home Assistant's `config` entities (child lock, power-on
   * behaviour, LED brightness…). The app keeps these under "More settings". Absent means false.
   */
  advanced?: boolean;
}

/**
 * Every capability below lists only what the entity reports it can do (Home Assistant's supported_features and
 * attributes): a `can…` flag that is false, a null value or an empty list means "not on this device", and the
 * backend refuses the matching command. Actions per capability are in backend/src/ha/commands.ts.
 */

/** power: on | off | toggle. Lights, switches, fans, media players, humidifiers, sirens, remotes, water heaters… */
export type PowerCapability = CapabilityBase & { type: 'power'; value: 'on' | 'off' | 'unknown' };
/** brightness: set (0–100; 0 turns the light off). */
export type BrightnessCapability = CapabilityBase & { type: 'brightness'; value: number | null };
/** color_temp: set (kelvin, clamped to min–max). */
export type ColorTempCapability = CapabilityBase & { type: 'color_temp'; value: number | null; min: number; max: number };
/** color: set ({ h: 0–360, s: 0–100 }). */
export type ColorCapability = CapabilityBase & { type: 'color'; value: { h: number; s: number } | null };
/**
 * climate: set_temperature (number) | set_temperature_range ({ low, high }) | set_mode | set_fan_mode | set_preset |
 * set_swing_mode (one of the lists) | set_humidity (number).
 */
export type ClimateCapability = CapabilityBase & {
  type: 'climate';
  current: number | null;
  /** Null when the device has no single target (see targetLow/targetHigh for a range). */
  target: number | null;
  /** A heat_cool range, when the device supports one. */
  targetLow: number | null;
  targetHigh: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  mode: string;
  modes: string[];
  fanMode: string | null;
  fanModes: string[];
  presetMode: string | null;
  presetModes: string[];
  swingMode: string | null;
  swingModes: string[];
  currentHumidity: number | null;
  /** Null when the device can't set a target humidity. */
  targetHumidity: number | null;
  minHumidity: number;
  maxHumidity: number;
};
/**
 * cover: open | close | stop | set_position (0–100) | open_tilt | close_tilt | stop_tilt | set_tilt (0–100).
 */
export type CoverCapability = CapabilityBase & {
  type: 'cover';
  position: number | null;
  state: string;
  canPosition: boolean;
  canStop: boolean;
  /** Slat angle, 0–100, when the cover tilts. */
  tilt: number | null;
  canTilt: boolean;
  canSetTilt: boolean;
};
/** lock: lock | unlock | open (unlatch). Unlock and open are refused to the assistant and always audited. */
export type LockCapability = CapabilityBase & { type: 'lock'; value: string; canOpen: boolean };
/** fan: set_percentage (0–100) | set_preset | set_oscillating (boolean) | set_direction (forward | reverse). */
export type FanCapability = CapabilityBase & {
  type: 'fan';
  percentage: number | null;
  /** The speed steps the fan really has (Home Assistant's percentage_step), e.g. 33.33 for three speeds. */
  percentageStep: number;
  presetMode: string | null;
  presetModes: string[];
  /** Null when the fan can't oscillate. */
  oscillating: boolean | null;
  /** Null when the fan can't change direction. */
  direction: 'forward' | 'reverse' | null;
};
/**
 * media: play | pause | play_pause | stop | next | previous | set_volume (0–1) | volume_up | volume_down |
 * mute (boolean) | select_source | select_sound_mode | set_shuffle (boolean) | set_repeat (off | one | all).
 */
export type MediaCapability = CapabilityBase & {
  type: 'media';
  state: string;
  /** Null when the volume can't be set to a level (volume_up/down may still work: canVolumeStep). */
  volume: number | null;
  muted: boolean | null;
  title: string | null;
  artist: string | null;
  source: string | null;
  sources: string[];
  soundMode: string | null;
  soundModes: string[];
  /** Null when not supported. */
  shuffle: boolean | null;
  repeat: 'off' | 'one' | 'all' | null;
  canPlay: boolean;
  canPause: boolean;
  canStop: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canVolumeStep: boolean;
};
/** press: press. Buttons (button, input_button). */
export type PressCapability = CapabilityBase & { type: 'press' };
/**
 * option: select (one of `options`). A setting with a fixed list: select / input_select entities, a light's effects
 * (role 'effect'), a remote's activities (role 'activity').
 */
export type OptionCapability = CapabilityBase & {
  type: 'option';
  value: string | null;
  options: string[];
  role: 'setting' | 'effect' | 'activity';
};
/** number: set (clamped to min–max and rounded to step). number / input_number entities. */
export type NumberCapability = CapabilityBase & {
  type: 'number';
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit: string | null;
};
/** vacuum: start | pause | stop | return_to_base | locate | clean_spot | set_fan_speed (one of fanSpeeds). */
export type VacuumCapability = CapabilityBase & {
  type: 'vacuum';
  /** Home Assistant's activity: cleaning, docked, idle, paused, returning, error. */
  state: string;
  battery: number | null;
  fanSpeed: string | null;
  fanSpeeds: string[];
  canPause: boolean;
  canStop: boolean;
  canReturn: boolean;
  canLocate: boolean;
  canSpot: boolean;
};
/** humidifier: set_humidity (number, min–max) | set_mode (one of modes). On/off is its power capability. */
export type HumidifierCapability = CapabilityBase & {
  type: 'humidifier';
  current: number | null;
  target: number | null;
  min: number;
  max: number;
  mode: string | null;
  modes: string[];
};
/** water_heater: set_temperature (number) | set_mode (one of modes) | set_away (boolean). */
export type WaterHeaterCapability = CapabilityBase & {
  type: 'water_heater';
  current: number | null;
  target: number | null;
  min: number;
  max: number;
  unit: string;
  mode: string | null;
  modes: string[];
  /** Null when the heater has no away mode. */
  away: boolean | null;
};
/** valve: open | close | stop | set_position (0–100). Water and gas valves. */
export type ValveCapability = CapabilityBase & {
  type: 'valve';
  position: number | null;
  state: string;
  canPosition: boolean;
  canStop: boolean;
};
/**
 * alarm: arm ({ mode, code? }, mode one of `modes`) | disarm ({ code? }). Disarm is refused to the assistant; both
 * are audited. `codeRequired`: the panel wants its code to arm or disarm.
 */
export type AlarmCapability = CapabilityBase & {
  type: 'alarm';
  /** disarmed, armed_home, armed_away, armed_night, armed_vacation, arming, pending, triggered… */
  state: string;
  modes: ('home' | 'away' | 'night' | 'vacation' | 'custom_bypass')[];
  codeRequired: boolean;
};
/** mower: start | pause | dock. */
export type MowerCapability = CapabilityBase & {
  type: 'mower';
  /** mowing, docked, paused, returning, error. */
  state: string;
  canPause: boolean;
  canDock: boolean;
};

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
  | PressCapability
  | OptionCapability
  | NumberCapability
  | VacuumCapability
  | HumidifierCapability
  | WaterHeaterCapability
  | ValveCapability
  | AlarmCapability
  | MowerCapability;

export type CapabilityType = Capability['type'];

export interface SensorReading {
  entityId: string;
  label: string;
  value: string;
  unit: string | null;
  deviceClass: string | null;
}

export interface Device {
  /**
   * The Home Assistant device id, `e.<entity_id>` for an entity without a device, or
   * `gw.<device id>` for a device on the unit's CUBE gateway (assistant tokens only).
   */
  id: string;
  name: string;
  roomId: string | null;
  room: string | null;
  kind: DeviceKind;
  manufacturer: string | null;
  model: string | null;
  /** The integration that provides it, e.g. `tuya`; `cube_gateway` for a device on the unit's gateway. */
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
