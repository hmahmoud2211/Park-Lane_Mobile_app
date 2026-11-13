import type { IconSet } from '../../../types/icons.types';
import type { Capability, CapabilityType, Command, Device, DeviceKind, Room } from '../../../types/home.types';
import {
  alarmStateLabel,
  climateModeLabel,
  lockStateLabel,
  mediaStateLabel,
  mowerStateLabel,
  openStateLabel,
  percentText,
  powerLabel,
  readingText,
  temperatureText,
  vacuumStateLabel,
} from './deviceLabels';

/** Reading devices and predicting what a command will do, for the cards and controls. Pure. */

export function capabilityOf<T extends CapabilityType>(device: Device, type: T): Extract<Capability, { type: T }> | undefined {
  return device.capabilities.find((capability) => capability.type === type) as Extract<Capability, { type: T }> | undefined;
}

/** Whether the device is on, for its card's switch; null when it has no on/off. */
export function isOn(device: Device): boolean | null {
  const power = capabilityOf(device, 'power');
  if (power) {
    return power.value === 'on';
  }
  const climate = capabilityOf(device, 'climate');
  if (climate) {
    return climate.mode !== 'off';
  }
  return null;
}

/** The mode a climate device goes back to when switched on from its card. */
export function climateOnMode(modes: readonly string[]): string | null {
  return ['cool', 'heat_cool', 'auto', 'heat'].find((mode) => modes.includes(mode)) ?? modes.find((mode) => mode !== 'off') ?? null;
}

/** The command a card's switch sends, or null for a device it cannot switch. */
export function toggleCommand(device: Device, on: boolean): Command | null {
  if (capabilityOf(device, 'power')) {
    return { capability: 'power', action: on ? 'on' : 'off' };
  }
  const climate = capabilityOf(device, 'climate');
  if (climate) {
    const mode = on ? climateOnMode(climate.modes) : climate.modes.includes('off') ? 'off' : null;
    return mode ? { capability: 'climate', action: 'set_mode', value: mode } : null;
  }
  return null;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A predicted capability after `command`, or the capability unchanged when the result can't be foreseen. */
function predict(capability: Capability, command: Command): Capability {
  const { action, value } = command;
  switch (capability.type) {
    case 'power':
      if (action === 'toggle') return { ...capability, value: capability.value === 'on' ? 'off' : 'on' };
      return action === 'on' || action === 'off' ? { ...capability, value: action } : capability;
    case 'brightness':
    case 'color_temp':
      return isNumber(value) ? { ...capability, value } : capability;
    case 'color': {
      const hs = value as { h?: unknown; s?: unknown } | null | undefined;
      return hs && isNumber(hs.h) && isNumber(hs.s) ? { ...capability, value: { h: hs.h, s: hs.s } } : capability;
    }
    case 'climate': {
      const range = value as { low?: unknown; high?: unknown } | null | undefined;
      if (action === 'set_temperature' && isNumber(value)) return { ...capability, target: value };
      if (action === 'set_temperature_range' && range && isNumber(range.low) && isNumber(range.high)) {
        return { ...capability, targetLow: range.low, targetHigh: range.high };
      }
      if (action === 'set_mode' && isText(value)) return { ...capability, mode: value };
      if (action === 'set_fan_mode' && isText(value)) return { ...capability, fanMode: value };
      if (action === 'set_preset' && isText(value)) return { ...capability, presetMode: value };
      if (action === 'set_swing_mode' && isText(value)) return { ...capability, swingMode: value };
      if (action === 'set_humidity' && isNumber(value)) return { ...capability, targetHumidity: value };
      return capability;
    }
    case 'cover':
      if (action === 'set_position' && isNumber(value)) return { ...capability, position: value };
      if (action === 'open') return { ...capability, state: 'opening' };
      if (action === 'close') return { ...capability, state: 'closing' };
      if (action === 'stop') return capability.state === 'opening' || capability.state === 'closing' ? { ...capability, state: 'open' } : capability;
      if (action === 'set_tilt' && isNumber(value)) return { ...capability, tilt: value };
      if (action === 'open_tilt') return { ...capability, tilt: 100 };
      if (action === 'close_tilt') return { ...capability, tilt: 0 };
      return capability;
    case 'valve':
      if (action === 'set_position' && isNumber(value)) return { ...capability, position: value };
      if (action === 'open') return { ...capability, state: 'opening' };
      if (action === 'close') return { ...capability, state: 'closing' };
      if (action === 'stop') return capability.state === 'opening' || capability.state === 'closing' ? { ...capability, state: 'open' } : capability;
      return capability;
    case 'lock':
      if (action === 'lock') return { ...capability, value: 'locking' };
      if (action === 'unlock') return { ...capability, value: 'unlocking' };
      if (action === 'open') return { ...capability, value: 'opening' };
      return capability;
    case 'fan':
      if (action === 'set_percentage' && isNumber(value)) return { ...capability, percentage: value };
      if (action === 'set_preset' && isText(value)) return { ...capability, presetMode: value };
      if (action === 'set_oscillating' && typeof value === 'boolean') return { ...capability, oscillating: value };
      if (action === 'set_direction' && (value === 'forward' || value === 'reverse')) return { ...capability, direction: value };
      return capability;
    case 'media':
      if (action === 'play') return { ...capability, state: 'playing' };
      if (action === 'pause') return { ...capability, state: 'paused' };
      if (action === 'play_pause') return { ...capability, state: capability.state === 'playing' ? 'paused' : 'playing' };
      if (action === 'stop') return { ...capability, state: 'idle' };
      if (action === 'set_volume' && isNumber(value)) return { ...capability, volume: clampTo(value, 0, 1) };
      if ((action === 'volume_up' || action === 'volume_down') && capability.volume !== null) {
        return { ...capability, volume: clampTo(capability.volume + (action === 'volume_up' ? 0.05 : -0.05), 0, 1) };
      }
      if (action === 'mute' && typeof value === 'boolean') return { ...capability, muted: value };
      if (action === 'select_source' && isText(value)) return { ...capability, source: value };
      if (action === 'select_sound_mode' && isText(value)) return { ...capability, soundMode: value };
      if (action === 'set_shuffle' && typeof value === 'boolean') return { ...capability, shuffle: value };
      if (action === 'set_repeat' && (value === 'off' || value === 'one' || value === 'all')) return { ...capability, repeat: value };
      return capability;
    case 'option':
      return action === 'select' && isText(value) && capability.options.includes(value) ? { ...capability, value } : capability;
    case 'number': {
      if (action !== 'set' || !isNumber(value)) return capability;
      const stepped = capability.step > 0 ? capability.min + Math.round((value - capability.min) / capability.step) * capability.step : value;
      return { ...capability, value: Number(clampTo(stepped, capability.min, capability.max).toFixed(4)) };
    }
    case 'vacuum':
      if (action === 'start' || action === 'clean_spot') return { ...capability, state: 'cleaning' };
      if (action === 'pause') return { ...capability, state: 'paused' };
      if (action === 'stop') return { ...capability, state: 'idle' };
      if (action === 'return_to_base') return { ...capability, state: 'returning' };
      if (action === 'set_fan_speed' && isText(value)) return { ...capability, fanSpeed: value };
      return capability;
    case 'humidifier':
      if (action === 'set_humidity' && isNumber(value)) return { ...capability, target: clampTo(value, capability.min, capability.max) };
      if (action === 'set_mode' && isText(value)) return { ...capability, mode: value };
      return capability;
    case 'water_heater':
      if (action === 'set_temperature' && isNumber(value)) return { ...capability, target: clampTo(value, capability.min, capability.max) };
      if (action === 'set_mode' && isText(value)) return { ...capability, mode: value };
      if (action === 'set_away' && typeof value === 'boolean') return { ...capability, away: value };
      return capability;
    case 'alarm':
      if (action === 'arm') return { ...capability, state: 'arming' };
      if (action === 'disarm') return { ...capability, state: 'disarming' };
      return capability;
    case 'mower':
      if (action === 'start') return { ...capability, state: 'mowing' };
      if (action === 'pause') return { ...capability, state: 'paused' };
      if (action === 'dock') return { ...capability, state: 'returning' };
      return capability;
    default:
      return capability;
  }
}

/**
 * The device as it will look once the command lands, shown while the hub
 * works on it; the backend's answer (or a rollback) replaces it.
 */
export function applyOptimistic(device: Device, command: Command): Device {
  const capabilities = device.capabilities.map((capability): Capability => {
    if (capability.type !== command.capability || (command.entityId && capability.entityId !== command.entityId)) {
      // A light's brightness and a fan's speed also switch it: 0 is off, anything more on.
      const level =
        (command.capability === 'brightness' && command.action === 'set') || (command.capability === 'fan' && command.action === 'set_percentage');
      if (level && capability.type === 'power' && isNumber(command.value)) {
        return { ...capability, value: command.value > 0 ? 'on' : 'off' };
      }
      return capability;
    }
    return predict(capability, command);
  });
  return { ...device, capabilities, pending: { entityId: command.entityId ?? '', capability: command.capability, action: command.action } };
}

export interface Glyph {
  iconSet: IconSet;
  iconName: string;
}

const KIND_GLYPHS: Record<DeviceKind, Glyph> = {
  light: { iconSet: 'material', iconName: 'lightbulb-on-outline' },
  switch: { iconSet: 'material', iconName: 'toggle-switch-outline' },
  plug: { iconSet: 'material', iconName: 'power-socket-eu' },
  climate: { iconSet: 'material', iconName: 'snowflake' },
  cover: { iconSet: 'material', iconName: 'curtains' },
  lock: { iconSet: 'material', iconName: 'lock-outline' },
  fan: { iconSet: 'material', iconName: 'fan' },
  media: { iconSet: 'material', iconName: 'television' },
  vacuum: { iconSet: 'material', iconName: 'robot-vacuum' },
  humidifier: { iconSet: 'material', iconName: 'air-humidifier' },
  water_heater: { iconSet: 'material', iconName: 'water-boiler' },
  valve: { iconSet: 'material', iconName: 'pipe-valve' },
  alarm: { iconSet: 'material', iconName: 'shield-home-outline' },
  mower: { iconSet: 'material', iconName: 'robot-mower-outline' },
  sensor: { iconSet: 'material', iconName: 'thermometer' },
  other: { iconSet: 'material', iconName: 'chip' },
};

export const kindGlyph = (kind: DeviceKind): Glyph => KIND_GLYPHS[kind] ?? KIND_GLYPHS.other;

/** A room's chip icon: Home Assistant's `mdi:` icons are the Material Community set the app already uses. */
export function roomGlyph(room: Room): Glyph {
  return room.icon?.startsWith('mdi:')
    ? { iconSet: 'material', iconName: room.icon.slice(4) }
    : { iconSet: 'material', iconName: 'door' };
}

const KIND_LABELS: Record<DeviceKind, string> = {
  light: 'Light',
  switch: 'Switch',
  plug: 'Plug',
  climate: 'Air conditioning',
  cover: 'Curtains & blinds',
  lock: 'Lock',
  fan: 'Fan',
  media: 'TV & media',
  vacuum: 'Robot vacuum',
  humidifier: 'Humidifier',
  water_heater: 'Water heater',
  valve: 'Valve',
  alarm: 'Alarm',
  mower: 'Lawn mower',
  sensor: 'Sensor',
  other: 'Device',
};

export const kindLabel = (kind: DeviceKind) => KIND_LABELS[kind] ?? KIND_LABELS.other;

/** "21° → 23°": where it is now, then where it is heading; either half alone when the other is unknown. */
function heading(current: string | null, target: string | null): string | null {
  if (current && target) return `${current} → ${target}`;
  return target ?? current;
}

/** One line saying in words what the device is doing, as its card shows it. */
export function stateLine(device: Device): string {
  if (!device.online) {
    return 'Not responding';
  }
  const power = capabilityOf(device, 'power');
  const climate = capabilityOf(device, 'climate');
  if (climate) {
    if (climate.mode === 'off' || power?.value === 'off') return 'Off';
    const current = climate.current !== null ? temperatureText(climate.current, climate.unit) : null;
    const target =
      climate.target !== null
        ? temperatureText(climate.target, climate.unit)
        : climate.targetLow !== null && climate.targetHigh !== null
          ? `${temperatureText(climate.targetLow, climate.unit)}–${temperatureText(climate.targetHigh, climate.unit)}`
          : null;
    const temperatures = heading(current, target);
    const mode = climateModeLabel(climate.mode, climate.modes);
    return temperatures ? `${mode} · ${temperatures}` : mode;
  }
  const vacuum = capabilityOf(device, 'vacuum');
  if (vacuum) {
    const words = vacuumStateLabel(vacuum.state);
    return vacuum.battery !== null ? `${words} · battery ${percentText(vacuum.battery)}` : words;
  }
  const mower = capabilityOf(device, 'mower');
  if (mower) return mowerStateLabel(mower.state);
  const alarm = capabilityOf(device, 'alarm');
  if (alarm) return alarmStateLabel(alarm.state);
  const lock = capabilityOf(device, 'lock');
  if (lock) return lockStateLabel(lock.value);
  const cover = capabilityOf(device, 'cover') ?? capabilityOf(device, 'valve');
  if (cover) {
    const moving = cover.state === 'opening' || cover.state === 'closing';
    return cover.position !== null && !moving && cover.position > 0 && cover.position < 100
      ? `${openStateLabel(cover.state)} · ${percentText(cover.position)}`
      : openStateLabel(cover.state);
  }
  const media = capabilityOf(device, 'media');
  if (media) {
    if (media.state === 'off' || power?.value === 'off') return 'Off';
    // A TV that gives no feedback knows only whether it is on.
    if ((media.state === 'unknown' || media.state === 'on') && power) return powerLabel(power.value);
    return media.title ? `${mediaStateLabel(media.state)} · ${media.title}` : mediaStateLabel(media.state);
  }
  const humidifier = capabilityOf(device, 'humidifier');
  if (humidifier && power?.value !== 'off') {
    const now = humidifier.current !== null ? percentText(humidifier.current) : null;
    const target = humidifier.target !== null ? percentText(humidifier.target) : null;
    return heading(now, target) ?? 'On';
  }
  const heater = capabilityOf(device, 'water_heater');
  if (heater && power?.value !== 'off' && heater.mode !== 'off') {
    const now = heater.current !== null ? temperatureText(heater.current, heater.unit) : null;
    const target = heater.target !== null ? temperatureText(heater.target, heater.unit) : null;
    return heading(now, target) ?? 'On';
  }
  if (power) {
    const brightness = capabilityOf(device, 'brightness');
    if (power.value === 'on' && brightness?.value !== null && brightness?.value !== undefined) {
      return `On · ${percentText(brightness.value)}`;
    }
    return powerLabel(power.value);
  }
  const sensor = device.sensors[0];
  if (sensor) {
    return `${sensor.label} ${readingText(sensor.value, sensor.unit)}`;
  }
  return 'Ready';
}

export function sortDevices(devices: readonly Device[]): Device[] {
  return [...devices].sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿') || a.name.localeCompare(b.name));
}
