import { ApiError } from '../errors.ts';
import { clamp, number, oneOf } from '../ha/commands.ts';
import type { Capability, CommandRequest, Device, DeviceKind, SensorReading } from '../ha/types.ts';

/**
 * A CUBE gateway's devices in the home API's shape, and the home API's commands in the gateway's.
 *
 * The gateway describes a device with normalized capabilities (gateway/cube_gateway/models.py `Device`) and takes
 * normalized commands (`COMMANDS` there), which it accepts only when the device lists them in `commands`. This
 * turns one into the other so the Parklane Assistant sees one list: ids get the `gw.` prefix, a capability's key
 * becomes its `entityId`, and media volume is 0–1 as Home Assistant's is (the gateway's is 0–100).
 *
 * Only the commands below are ever sent; anything else is refused here, before the gateway sees it. Gateways have
 * no locks or alarms, so there is no unlock or disarm to refuse, and nothing here reaches pairing, rooms, phones or
 * settings. A capability's `can…` flags come from the device's `commands`; what the gateway has no command for is
 * false, null or empty.
 */

export const GATEWAY_ID_PREFIX = 'gw.';

/** The fields of a gateway device this reads (the gateway's JSON, snake_case). */
export interface GatewayCapability {
  key: string;
  type: string;
  label: string;
  value?: unknown;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  current?: number | null;
  target?: number | null;
  unit?: string | null;
  mode?: string | null;
  modes?: string[];
  fan_mode?: string | null;
  fan_modes?: string[];
  volume?: number | null;
  muted?: boolean | null;
  source?: string | null;
  sources?: string[];
  state?: string | null;
  percentage?: number | null;
  preset?: string | null;
  presets?: string[];
  position?: number | null;
}

export interface GatewayDevice {
  id: string;
  name: string;
  brand: string;
  model?: string | null;
  adapter_id: string;
  category: string;
  room_id?: string | null;
  room?: string | null;
  connection?: { status?: string; last_error?: string | null };
  capabilities?: GatewayCapability[];
  readings?: { key: string; label: string; value: unknown; unit?: string | null; device_class?: string | null }[];
  commands?: string[];
  updated_at?: number;
}

/** A gateway command, as POST /api/v1/devices/{id}/commands takes it. */
export interface GatewayCommand {
  command: string;
  params: Record<string, unknown>;
}

const KINDS: Record<string, DeviceKind> = {
  switch: 'switch',
  plug: 'plug',
  light: 'light',
  climate: 'climate',
  tv: 'media',
  fan: 'fan',
  sensor: 'sensor',
  cover: 'cover',
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function capabilityOf(raw: GatewayCapability, commands: readonly string[]): Capability | null {
  const base = { entityId: raw.key, label: raw.label };
  switch (raw.type) {
    case 'power':
      return { ...base, type: 'power', value: raw.value === 'on' || raw.value === 'off' ? raw.value : 'unknown' };
    case 'brightness':
      return { ...base, type: 'brightness', value: numberOrNull(raw.value) };
    case 'color_temp':
      return { ...base, type: 'color_temp', value: numberOrNull(raw.value), min: raw.min ?? 2700, max: raw.max ?? 6500 };
    case 'color': {
      const hs = raw.value as { h?: unknown; s?: unknown } | null | undefined;
      const value = hs && typeof hs.h === 'number' && typeof hs.s === 'number' ? { h: hs.h, s: hs.s } : null;
      return { ...base, type: 'color', value };
    }
    case 'climate':
      return {
        ...base,
        type: 'climate',
        current: numberOrNull(raw.current),
        target: numberOrNull(raw.target),
        // The gateway has no range, presets, swing or humidity commands (its settings are not mapped here).
        targetLow: null,
        targetHigh: null,
        min: raw.min ?? 16,
        max: raw.max ?? 30,
        step: raw.step ?? 1,
        unit: raw.unit ?? '°C',
        mode: raw.mode ?? 'unknown',
        modes: strings(raw.modes),
        fanMode: textOrNull(raw.fan_mode),
        fanModes: strings(raw.fan_modes),
        presetMode: null,
        presetModes: [],
        swingMode: null,
        swingModes: [],
        currentHumidity: null,
        targetHumidity: null,
        minHumidity: 30,
        maxHumidity: 99,
      };
    case 'media': {
      const volume = numberOrNull(raw.volume);
      return {
        ...base,
        type: 'media',
        state: raw.state ?? 'unknown',
        volume: volume === null ? null : clamp(volume / 100, 0, 1),
        muted: typeof raw.muted === 'boolean' ? raw.muted : null,
        title: null,
        artist: null,
        source: textOrNull(raw.source),
        sources: strings(raw.sources),
        soundMode: null,
        soundModes: [],
        shuffle: null,
        repeat: null,
        canPlay: commands.includes('media_play'),
        canPause: commands.includes('media_pause'),
        canStop: false,
        canNext: commands.includes('media_next'),
        canPrevious: commands.includes('media_previous'),
        canVolumeStep: commands.includes('volume_up') && commands.includes('volume_down'),
      };
    }
    case 'fan':
      return {
        ...base,
        type: 'fan',
        percentage: numberOrNull(raw.percentage),
        percentageStep: 1,
        presetMode: textOrNull(raw.preset),
        presetModes: strings(raw.presets),
        oscillating: null,
        direction: null,
      };
    case 'cover':
      return {
        ...base,
        type: 'cover',
        position: numberOrNull(raw.position),
        state: raw.state ?? 'unknown',
        canPosition: commands.includes('set_position'),
        canStop: commands.includes('cover_stop'),
        tilt: null,
        canTilt: false,
        canSetTilt: false,
      };
    default:
      return null;
  }
}

/** One gateway device in the home API's shape. */
export function toDevice(raw: GatewayDevice): Device {
  const commands = strings(raw.commands);
  const sensors: SensorReading[] = (raw.readings ?? []).map((reading) => ({
    entityId: reading.key,
    label: reading.label,
    value: reading.value === null || reading.value === undefined ? '' : String(reading.value),
    unit: reading.unit ?? null,
    deviceClass: reading.device_class ?? null,
  }));
  return {
    id: `${GATEWAY_ID_PREFIX}${raw.id}`,
    name: raw.name,
    roomId: raw.room_id ? `${GATEWAY_ID_PREFIX}${raw.room_id}` : null,
    room: raw.room ?? null,
    kind: KINDS[raw.category] ?? 'other',
    manufacturer: raw.brand || null,
    model: raw.model ?? null,
    integration: 'cube_gateway',
    accountId: null,
    online: raw.connection?.status === 'connected',
    capabilities: (raw.capabilities ?? []).map((capability) => capabilityOf(capability, commands)).filter((entry): entry is Capability => entry !== null),
    sensors,
    pending: null,
    lastChanged: numberOrNull(raw.updated_at),
    lastError: raw.connection?.last_error ?? null,
  };
}

type Build = (value: unknown, capability: Capability) => GatewayCommand;
const plain = (command: string): Build => () => ({ command, params: {} });
const as = <T extends Capability['type']>(capability: Capability, type: T) => capability as Extract<Capability, { type: T }>;

/** The home API's capability actions, and the gateway command each one becomes. */
const RULES: Partial<Record<Capability['type'], Record<string, Build>>> = {
  power: { on: plain('turn_on'), off: plain('turn_off'), toggle: plain('toggle') },
  brightness: {
    set: (value) => {
      const brightness = Math.round(clamp(number(value, 'Brightness'), 0, 100));
      return brightness === 0 ? { command: 'turn_off', params: {} } : { command: 'set_brightness', params: { brightness } };
    },
  },
  color_temp: {
    set: (value, capability) => {
      const { min, max } = as(capability, 'color_temp');
      return { command: 'set_color_temp', params: { kelvin: Math.round(clamp(number(value, 'Colour temperature'), min, max)) } };
    },
  },
  color: {
    set: (value) => {
      const hs = value as { h?: unknown; s?: unknown } | null;
      if (!hs || typeof hs !== 'object') throw new ApiError('bad_request', 'Colour must be { h, s }.');
      return { command: 'set_color', params: { h: clamp(number(hs.h, 'Hue'), 0, 360), s: clamp(number(hs.s, 'Saturation'), 0, 100) } };
    },
  },
  climate: {
    set_temperature: (value, capability) => {
      const { min, max } = as(capability, 'climate');
      return { command: 'set_temperature', params: { temperature: clamp(number(value, 'Temperature'), min, max) } };
    },
    set_mode: (value, capability) => ({ command: 'set_hvac_mode', params: { mode: oneOf(value, as(capability, 'climate').modes, 'Mode') } }),
    set_fan_mode: (value, capability) => ({
      command: 'set_fan_mode',
      params: { fan_mode: oneOf(value, as(capability, 'climate').fanModes, 'Fan mode') },
    }),
  },
  cover: {
    open: plain('cover_open'),
    close: plain('cover_close'),
    stop: plain('cover_stop'),
    set_position: (value) => ({ command: 'set_position', params: { position: Math.round(clamp(number(value, 'Position'), 0, 100)) } }),
  },
  fan: {
    set_percentage: (value) => ({ command: 'set_fan_speed', params: { percentage: Math.round(clamp(number(value, 'Speed'), 0, 100)) } }),
  },
  media: {
    play: plain('media_play'),
    pause: plain('media_pause'),
    // As Home Assistant's own media_play_pause does it: pause what is playing, play anything else.
    play_pause: (_value, capability) => ({ command: as(capability, 'media').state === 'playing' ? 'media_pause' : 'media_play', params: {} }),
    next: plain('media_next'),
    previous: plain('media_previous'),
    volume_up: plain('volume_up'),
    volume_down: plain('volume_down'),
    set_volume: (value) => ({ command: 'set_volume', params: { volume: Math.round(clamp(number(value, 'Volume'), 0, 1) * 100) } }),
    mute: (value) => {
      if (typeof value !== 'boolean') throw new ApiError('bad_request', 'Mute takes true or false.');
      return { command: 'mute', params: { muted: value } };
    },
    select_source: (value, capability) => ({ command: 'set_source', params: { source: oneOf(value, as(capability, 'media').sources, 'Source') } }),
  },
};

/** The one gateway command a home API command becomes, checked against what the device reports; or a 4xx ApiError. */
export function toGatewayCommand(raw: GatewayDevice, request: CommandRequest): GatewayCommand {
  const device = toDevice(raw);
  const rules = Object.hasOwn(RULES, request.capability) ? RULES[request.capability] : undefined;
  const build = rules && Object.hasOwn(rules, request.action) ? rules[request.action] : undefined;
  if (!build) {
    throw new ApiError('not_available', `Devices on the home gateway can't do ${request.capability} ${request.action}.`);
  }
  const capability = device.capabilities.find(
    (entry) => entry.type === request.capability && (request.entityId === undefined || entry.entityId === request.entityId),
  );
  if (!capability) {
    throw new ApiError('not_available', 'This device cannot do that.');
  }
  const command = build(request.value, capability);
  if (!strings(raw.commands).includes(command.command)) {
    throw new ApiError('not_available', 'This device cannot do that.');
  }
  return command;
}
