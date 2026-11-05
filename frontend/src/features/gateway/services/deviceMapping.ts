import type { Capability, CapabilityType, Command, Device, DeviceKind, Room, SensorReading } from '../../../types/home.types';
import type {
  ConnectionStatus,
  GatewayCapability,
  GatewayCategory,
  GatewayCommand,
  GatewayCommandName,
  GatewayDevice,
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

function mapCapability(capability: GatewayCapability, commands: readonly string[]): Capability | null {
  const base = { entityId: capability.key, label: capability.label };
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
    case 'climate':
      return {
        ...base,
        type: 'climate',
        current: capability.current,
        target: capability.target,
        min: capability.min ?? 16,
        max: capability.max ?? 30,
        step: capability.step ?? 1,
        unit: capability.unit ?? '°C',
        mode: capability.mode ?? 'off',
        modes: capability.modes,
        fanMode: capability.fan_mode,
        fanModes: capability.fan_modes,
      };
    case 'cover':
      return {
        ...base,
        type: 'cover',
        position: capability.position,
        state: capability.state ?? 'unknown',
        canPosition: commands.includes('set_position'),
        canStop: commands.includes('cover_stop'),
      };
    case 'fan':
      return { ...base, type: 'fan', percentage: capability.percentage, presetMode: capability.preset, presetModes: capability.presets };
    case 'media':
      return {
        ...base,
        type: 'media',
        state: capability.state ?? 'unknown',
        // The gateway reports 0-100; the app's media control works in 0-1.
        volume: capability.volume !== null ? capability.volume / 100 : null,
        muted: capability.muted,
        title: null,
        source: capability.source,
        sources: capability.sources,
      };
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
    .map((capability) => mapCapability(capability, device.commands))
    .filter((capability): capability is Capability => capability !== null);
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

/**
 * The gateway command for one of the app's controls, or null when the
 * gateway has no equivalent or this device does not accept it.
 */
export function toGatewayCommand(command: Command, accepted: readonly string[]): GatewayCommand | null {
  const key = command.entityId ? { key: command.entityId } : {};
  let next: GatewayCommand | null = null;
  switch (command.capability) {
    case 'power':
      next = { command: command.action === 'on' ? 'turn_on' : command.action === 'off' ? 'turn_off' : 'toggle', params: key };
      break;
    case 'brightness':
      next = { command: 'set_brightness', params: { ...key, brightness: command.value } };
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
      break;
    case 'media':
      if (command.action === 'play') next = { command: 'media_play', params: key };
      else if (command.action === 'pause') next = { command: 'media_pause', params: key };
      else if (command.action === 'next') next = { command: 'media_next', params: key };
      else if (command.action === 'previous') next = { command: 'media_previous', params: key };
      else if (command.action === 'set_volume' && typeof command.value === 'number')
        next = { command: 'set_volume', params: { ...key, volume: Math.round(command.value * 100) } };
      else if (command.action === 'mute') next = { command: 'mute', params: { ...key, muted: Boolean(command.value) } };
      else if (command.action === 'select_source') next = { command: 'set_source', params: { ...key, source: command.value } };
      break;
    default:
      next = null;
  }
  return next && accepted.includes(next.command) ? next : null;
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

