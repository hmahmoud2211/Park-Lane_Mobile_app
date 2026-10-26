import type { IconSet } from '../../components/ui/ServiceTile';
import type { Capability, CapabilityType, Command, Device, DeviceKind, Room } from '../../types/home.types';

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

/**
 * The device as it will look once the command lands, shown while the hub
 * works on it; the backend's answer (or a rollback) replaces it.
 */
export function applyOptimistic(device: Device, command: Command): Device {
  const capabilities = device.capabilities.map((capability): Capability => {
    if (capability.type !== command.capability || (command.entityId && capability.entityId !== command.entityId)) {
      if (command.capability === 'brightness' && capability.type === 'power' && typeof command.value === 'number') {
        return { ...capability, value: command.value > 0 ? 'on' : 'off' };
      }
      return capability;
    }
    switch (capability.type) {
      case 'power':
        return command.action === 'toggle'
          ? { ...capability, value: capability.value === 'on' ? 'off' : 'on' }
          : { ...capability, value: command.action === 'on' ? 'on' : 'off' };
      case 'brightness':
        return typeof command.value === 'number' ? { ...capability, value: command.value } : capability;
      case 'color_temp':
        return typeof command.value === 'number' ? { ...capability, value: command.value } : capability;
      case 'climate':
        if (command.action === 'set_temperature' && typeof command.value === 'number') return { ...capability, target: command.value };
        if (command.action === 'set_mode' && typeof command.value === 'string') return { ...capability, mode: command.value };
        if (command.action === 'set_fan_mode' && typeof command.value === 'string') return { ...capability, fanMode: command.value };
        return capability;
      case 'cover':
        if (command.action === 'set_position' && typeof command.value === 'number') return { ...capability, position: command.value };
        if (command.action === 'open' || command.action === 'close') return { ...capability, state: command.action === 'open' ? 'opening' : 'closing' };
        return capability;
      case 'lock':
        return { ...capability, value: command.action === 'lock' ? 'locking' : 'unlocking' };
      case 'fan':
        if (command.action === 'set_percentage' && typeof command.value === 'number') return { ...capability, percentage: command.value };
        if (command.action === 'set_preset' && typeof command.value === 'string') return { ...capability, presetMode: command.value };
        return capability;
      case 'media':
        if (command.action === 'set_volume' && typeof command.value === 'number') return { ...capability, volume: command.value };
        if (command.action === 'mute' && typeof command.value === 'boolean') return { ...capability, muted: command.value };
        if (command.action === 'select_source' && typeof command.value === 'string') return { ...capability, source: command.value };
        return capability;
      default:
        return capability;
    }
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
  sensor: { iconSet: 'material', iconName: 'thermometer' },
  other: { iconSet: 'material', iconName: 'chip' },
};

export const kindGlyph = (kind: DeviceKind): Glyph => KIND_GLYPHS[kind];

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
  sensor: 'Sensor',
  other: 'Device',
};

export const kindLabel = (kind: DeviceKind) => KIND_LABELS[kind];

const title = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());

/** One line saying what the device is doing, as its card shows it. */
export function stateLine(device: Device): string {
  if (!device.online) {
    return 'Offline';
  }
  if (device.pending) {
    return 'Updating…';
  }
  const climate = capabilityOf(device, 'climate');
  if (climate) {
    const target = climate.target !== null ? ` · set to ${climate.target}${climate.unit}` : '';
    return climate.mode === 'off' ? 'Off' : `${title(climate.mode)}${target}`;
  }
  const cover = capabilityOf(device, 'cover');
  if (cover) {
    return cover.position !== null ? `${title(cover.state)} · ${cover.position}%` : title(cover.state);
  }
  const lock = capabilityOf(device, 'lock');
  if (lock) {
    return title(lock.value);
  }
  const media = capabilityOf(device, 'media');
  if (media && media.state !== 'off') {
    return media.title ? `${title(media.state)} · ${media.title}` : title(media.state);
  }
  const power = capabilityOf(device, 'power');
  if (power) {
    const brightness = capabilityOf(device, 'brightness');
    if (power.value === 'on' && brightness?.value !== null && brightness?.value !== undefined) {
      return `On · ${brightness.value}%`;
    }
    return power.value === 'unknown' ? 'State unknown' : power.value === 'on' ? 'On' : 'Off';
  }
  const sensor = device.sensors[0];
  if (sensor) {
    return `${sensor.label} ${sensor.value}${sensor.unit ? ` ${sensor.unit}` : ''}`;
  }
  return 'Online';
}

export function sortDevices(devices: readonly Device[]): Device[] {
  return [...devices].sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿') || a.name.localeCompare(b.name));
}
