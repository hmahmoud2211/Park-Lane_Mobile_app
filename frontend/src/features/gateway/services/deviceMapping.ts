import type { Capability, CapabilityType, Command, Device, DeviceKind, Room, SensorReading } from '../../../types/home.types';
import type {
  ConnectionStatus,
  GatewayCapability,
  GatewayCategory,
  GatewayCommand,
  GatewayCommandName,
  GatewayDevice,
  GatewayReading,
  GatewayRoom,
} from '../../../types/gateway.types';
import type { ControlPower, ControlSetting, DeviceControls } from '../../../types/controls.types';

/**
 * Gateway devices in the app's own device model, so the same cards and
 * controls (components/home) show hub and gateway devices alike, and the
 * app's commands in the gateway's normalized vocabulary (models.COMMANDS).
 * Pure.
 *
 * A capability's `key` (power:1, light:0, …) becomes its entityId and travels
 * back as params.key, so a two-gang switch's second output is the one that
 * switches.
 */

/** Gateway device ids are prefixed so they never collide with hub device ids in one list. */
export const GATEWAY_ID_PREFIX = 'gw:';

export const toAppDeviceId = (gatewayDeviceId: string) => `${GATEWAY_ID_PREFIX}${gatewayDeviceId}`;

export const isGatewayDeviceId = (id: string) => id.startsWith(GATEWAY_ID_PREFIX);

export const toGatewayDeviceId = (appDeviceId: string) =>
  isGatewayDeviceId(appDeviceId) ? appDeviceId.slice(GATEWAY_ID_PREFIX.length) : appDeviceId;

const KINDS: Record<GatewayCategory, DeviceKind> = {
  switch: 'switch',
  plug: 'plug',
  light: 'light',
  climate: 'climate',
  tv: 'media',
  fan: 'fan',
  sensor: 'sensor',
  camera: 'other',
  cover: 'cover',
  other: 'other',
};

/** Statuses in which the gateway can talk to the device. */
const REACHABLE: ReadonlySet<ConnectionStatus> = new Set<ConnectionStatus>(['connected', 'experimental', 'identified', 'discovered']);

export const isReachable = (status: ConnectionStatus) => REACHABLE.has(status);

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function powerValue(value: unknown): 'on' | 'off' | 'unknown' {
  return value === 'on' || value === true ? 'on' : value === 'off' || value === false ? 'off' : 'unknown';
}

/**
 * One gateway capability in the app's model. What the device can do comes from the
 * commands it accepts (models.COMMANDS), so a control the app shows always has a gateway
 * command behind it: a list is empty, a `can…` flag false and a level null when the
 * gateway has no command for it (it has none for presets on an AC, swing, tilt, shuffle…).
 */
function mapCapability(capability: GatewayCapability, commands: readonly string[], readings: readonly GatewayReading[]): Capability | null {
  const base = { entityId: capability.key, label: capability.label };
  const has = (command: GatewayCommandName) => commands.includes(command);
  switch (capability.type) {
    case 'power':
      return { ...base, type: 'power', value: powerValue(capability.value) };
    case 'brightness':
      return { ...base, type: 'brightness', value: num(capability.value) };
    case 'color_temp':
      return { ...base, type: 'color_temp', value: num(capability.value), min: capability.min ?? 2700, max: capability.max ?? 6500 };
    case 'color': {
      const value = capability.value as { h?: unknown; s?: unknown } | null;
      const h = num(value?.h);
      const s = num(value?.s);
      return { ...base, type: 'color', value: h !== null && s !== null ? { h, s } : null };
    }
    case 'climate': {
      const humidity = num(readings.find((reading) => reading.key === 'current_humidity')?.value);
      return {
        ...base,
        type: 'climate',
        current: capability.current,
        target: capability.target,
        targetLow: null,
        targetHigh: null,
        min: capability.min ?? 16,
        max: capability.max ?? 30,
        step: capability.step ?? 1,
        unit: capability.unit ?? '°C',
        mode: capability.mode ?? 'off',
        modes: has('set_hvac_mode') ? capability.modes : [],
        fanMode: capability.fan_mode,
        fanModes: has('set_fan_mode') ? capability.fan_modes : [],
        // Shown when reported; the gateway has no command to change an AC's preset or swing
        // here (an LG AC's swing is a setting on the AC Controls screen).
        presetMode: capability.preset,
        presetModes: [],
        swingMode: null,
        swingModes: [],
        currentHumidity: humidity,
        targetHumidity: null,
        minHumidity: 0,
        maxHumidity: 100,
      };
    }
    case 'cover':
      return {
        ...base,
        type: 'cover',
        position: capability.position,
        state: capability.state ?? 'unknown',
        canPosition: has('set_position'),
        canStop: has('cover_stop'),
        tilt: null,
        canTilt: false,
        canSetTilt: false,
      };
    case 'fan':
      return {
        ...base,
        type: 'fan',
        percentage: has('set_fan_speed') ? (capability.percentage ?? 0) : null,
        percentageStep: capability.step ?? 1,
        presetMode: capability.preset,
        // A fan's preset goes as set_fan_mode (the ESPHome adapter's fan modes are its presets).
        presetModes: has('set_fan_mode') ? capability.presets : [],
        oscillating: null,
        direction: null,
      };
    case 'media': {
      // The gateway reports 0-100; the app's media control works in 0-1.
      const volume = has('set_volume') && capability.volume !== null ? Math.min(1, Math.max(0, capability.volume / 100)) : null;
      return {
        ...base,
        type: 'media',
        state: capability.state ?? 'unknown',
        volume,
        // A TV that gives no feedback reports no mute state; it can still be muted.
        muted: has('mute') ? (capability.muted ?? false) : null,
        title: null,
        artist: null,
        source: capability.source,
        sources: has('set_source') ? capability.sources : [],
        soundMode: null,
        soundModes: [],
        shuffle: null,
        repeat: null,
        canPlay: has('media_play'),
        canPause: has('media_pause'),
        canStop: false,
        canNext: has('media_next'),
        canPrevious: has('media_previous'),
        // Volume − / + go as volume_up/down, or as set_volume ± 5% (toGatewayCommand).
        canVolumeStep: (has('volume_up') && has('volume_down')) || volume !== null,
      };
    }
    default:
      return null;
  }
}

const PENDING_CAPABILITY: Partial<Record<GatewayCommandName, CapabilityType>> = {
  turn_on: 'power',
  turn_off: 'power',
  toggle: 'power',
  set_brightness: 'brightness',
  set_color: 'color',
  set_color_temp: 'color_temp',
  set_temperature: 'climate',
  set_hvac_mode: 'climate',
  set_fan_mode: 'climate',
  set_fan_speed: 'fan',
  set_volume: 'media',
  volume_up: 'media',
  volume_down: 'media',
  mute: 'media',
  set_source: 'media',
  media_play: 'media',
  media_pause: 'media',
  media_next: 'media',
  media_previous: 'media',
  cover_open: 'cover',
  cover_close: 'cover',
  cover_stop: 'cover',
  set_position: 'cover',
  press: 'press',
};

function formatReading(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return value === null || value === undefined ? '—' : String(value);
}

export function toAppDevice(device: GatewayDevice, brandName?: string): Device {
  const capabilities = device.capabilities
    .map((capability) => mapCapability(capability, device.commands, device.readings))
    .filter((capability): capability is Capability => capability !== null);
  // The device's buttons (a TV's remote keys: up, ok, back, channel_up…) go back as `press`.
  if (device.commands.includes('press')) {
    for (const setting of device.settings) {
      if (setting.kind === 'button' && setting.available !== false) {
        capabilities.push({ entityId: setting.key, label: setting.name, type: 'press', ...(setting.diagnostic ? { advanced: true } : {}) });
      }
    }
  }
  const sensors: SensorReading[] = device.readings.map((reading) => ({
    entityId: reading.key,
    label: reading.label,
    value: formatReading(reading.value),
    unit: reading.unit,
    deviceClass: reading.device_class,
  }));
  const pendingCapability = device.pending ? PENDING_CAPABILITY[device.pending.command as GatewayCommandName] : undefined;
  return {
    id: toAppDeviceId(device.id),
    name: device.name,
    roomId: device.room_id,
    room: device.room,
    kind: KINDS[device.category] ?? 'other',
    manufacturer: brandName ?? device.brand,
    model: device.model,
    integration: device.protocol ?? device.adapter_id,
    accountId: null,
    online: isReachable(device.connection.status),
    capabilities,
    sensors,
    pending:
      device.pending && pendingCapability
        ? { entityId: String(device.pending.params.key ?? ''), capability: pendingCapability, action: device.pending.command }
        : null,
    lastChanged: device.updated_at,
    lastError: device.connection.last_error,
    source: 'gateway',
    assumed: device.capabilities.some((capability) => !capability.confirmed),
    experimental: device.experimental,
  };
}

export const toAppRoom = (room: GatewayRoom): Room => ({ id: room.id, name: room.name, icon: null, deviceCount: room.device_count });

/** The device's capability a command is for: the one it names, else the first of its type. */
function targetOf<T extends CapabilityType>(device: Device | undefined, type: T, entityId: string | undefined) {
  return device?.capabilities.find((capability) => capability.type === type && (!entityId || capability.entityId === entityId)) as
    | Extract<Capability, { type: T }>
    | undefined;
}

/**
 * The gateway command for one of the app's controls, or null when the
 * gateway has no equivalent or this device does not accept it.
 *
 * Actions the gateway has no command of its own for fall back on one it
 * accepts, using `device` (the app's view of it) for the state they need:
 * toggle becomes turn_on / turn_off, play_pause play or pause, stop pause,
 * and volume_up / volume_down the set level ± 5%.
 */
export function toGatewayCommand(command: Command, accepted: readonly string[], device?: Device): GatewayCommand | null {
  const key = command.entityId ? { key: command.entityId } : {};
  const has = (name: GatewayCommandName) => accepted.includes(name);
  let next: GatewayCommand | null = null;
  switch (command.capability) {
    case 'power': {
      const power = targetOf(device, 'power', command.entityId);
      const fallback = power && power.value !== 'unknown' ? (power.value === 'on' ? 'turn_off' : 'turn_on') : 'toggle';
      next = {
        command: command.action === 'on' ? 'turn_on' : command.action === 'off' ? 'turn_off' : has('toggle') ? 'toggle' : fallback,
        params: key,
      };
      break;
    }
    case 'brightness':
      next =
        command.value === 0 && has('turn_off')
          ? { command: 'turn_off', params: key }
          : { command: 'set_brightness', params: { ...key, brightness: command.value } };
      break;
    case 'color_temp':
      next = { command: 'set_color_temp', params: { ...key, kelvin: command.value } };
      break;
    case 'color': {
      const value = command.value as { h: number; s: number } | undefined;
      next = value ? { command: 'set_color', params: { ...key, h: value.h, s: value.s } } : null;
      break;
    }
    case 'climate':
      if (command.action === 'set_temperature') next = { command: 'set_temperature', params: { ...key, temperature: command.value } };
      else if (command.action === 'set_mode') next = { command: 'set_hvac_mode', params: { ...key, mode: command.value } };
      else if (command.action === 'set_fan_mode') next = { command: 'set_fan_mode', params: { ...key, fan_mode: command.value } };
      break;
    case 'cover':
      if (command.action === 'open') next = { command: 'cover_open', params: key };
      else if (command.action === 'close') next = { command: 'cover_close', params: key };
      else if (command.action === 'stop') next = { command: 'cover_stop', params: key };
      else if (command.action === 'set_position') next = { command: 'set_position', params: { ...key, position: command.value } };
      break;
    case 'fan':
      if (command.action === 'set_percentage') next = { command: 'set_fan_speed', params: { ...key, percentage: command.value } };
      else if (command.action === 'set_preset') next = { command: 'set_fan_mode', params: { ...key, fan_mode: command.value } };
      break;
    case 'media': {
      const media = targetOf(device, 'media', command.entityId);
      const step = (direction: 1 | -1): GatewayCommand | null => {
        if (has(direction > 0 ? 'volume_up' : 'volume_down')) return { command: direction > 0 ? 'volume_up' : 'volume_down', params: key };
        if (media?.volume === null || media?.volume === undefined) return null;
        const volume = Math.round(Math.min(1, Math.max(0, media.volume + direction * 0.05)) * 100);
        return { command: 'set_volume', params: { ...key, volume } };
      };
      if (command.action === 'play') next = { command: 'media_play', params: key };
      else if (command.action === 'pause' || command.action === 'stop') next = { command: 'media_pause', params: key };
      else if (command.action === 'play_pause') next = { command: media?.state === 'playing' ? 'media_pause' : 'media_play', params: key };
      else if (command.action === 'next') next = { command: 'media_next', params: key };
      else if (command.action === 'previous') next = { command: 'media_previous', params: key };
      else if (command.action === 'volume_up') next = step(1);
      else if (command.action === 'volume_down') next = step(-1);
      else if (command.action === 'set_volume' && typeof command.value === 'number')
        next = { command: 'set_volume', params: { ...key, volume: Math.round(command.value * 100) } };
      else if (command.action === 'mute') next = { command: 'mute', params: { ...key, muted: Boolean(command.value) } };
      else if (command.action === 'select_source') next = { command: 'set_source', params: { ...key, source: command.value } };
      break;
    }
    case 'press':
      next = command.entityId ? { command: 'press', params: { key: command.entityId } } : null;
      break;
    default:
      next = null;
  }
  return next && has(next.command) ? next : null;
}

/**
 * The AC Controls screen's view of a gateway device: power and action from
 * the climate capability, readings, and every setting the device announced
 * (an LG AC's swing, Jet, timers, filter). Unconfirmed values stay marked.
 */
export function toDeviceControls(device: GatewayDevice): DeviceControls {
  const climate = device.capabilities.find((capability) => capability.type === 'climate');
  const power = device.capabilities.find((capability) => capability.type === 'power');
  const humidity = device.readings.find((reading) => reading.key === 'current_humidity')?.value;
  const powerState: ControlPower = power
    ? power.value === 'on'
      ? 'on'
      : power.value === 'off'
        ? 'off'
        : 'unknown'
    : climate?.mode
      ? climate.mode === 'off'
        ? 'off'
        : 'on'
      : 'unknown';
  return {
    online: isReachable(device.connection.status),
    power: powerState,
    action: climate?.state ?? null,
    currentTemperature: climate?.current ?? null,
    currentHumidity: typeof humidity === 'number' ? humidity : null,
    settings: device.settings.map(
      (setting): ControlSetting => ({
        key: setting.key,
        kind: setting.kind,
        name: setting.name,
        value: setting.value,
        options: setting.options.length > 0 ? setting.options : undefined,
        min: setting.min ?? undefined,
        max: setting.max ?? undefined,
        step: setting.step ?? undefined,
        unit: setting.unit,
        available: setting.available,
        requires: setting.requires,
        description: setting.description,
        diagnostic: setting.diagnostic,
        confirmed: setting.confirmed,
      }),
    ),
  };
}

/** Whether a gateway device has settings for the AC Controls screen. */
export const hasControlSettings = (device: GatewayDevice) => device.settings.some((setting) => setting.kind !== 'sensor');

