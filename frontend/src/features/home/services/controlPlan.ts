import type {
  Capability,
  CapabilityType,
  Command,
  Device,
  DeviceKind,
  FanCapability,
  MediaCapability,
  NumberCapability,
  PowerCapability,
  PressCapability,
} from '../../../types/home.types';
import { climateOnMode } from './capabilities';

/**
 * How a device's screen is laid out, decided from what the device reports: one obvious
 * main control at the top, the rest of its everyday controls under "More controls", and its
 * settings (`advanced`) folded away under "More settings". Pure: checked by `npm run check:home`.
 */

export interface ControlPlan {
  /** The one obvious control at the top, or null (a sensor, or a device with only settings). */
  main: Capability | null;
  /** On/off switches drawn inside the main control: a TV's Power, the other outputs of a two-gang switch. */
  mainPower: PowerCapability[];
  /** A TV's remote keys (Up, OK, Back, Channel up…), drawn as a remote inside its main control. */
  remote: PressCapability[];
  /** Everyday controls under "More controls". */
  more: Capability[];
  /** Device settings under "More settings", folded away by default. */
  settings: Capability[];
}

/** Capability types that have a main control, in the order a device of each kind prefers them. */
const MAIN_BY_KIND: Readonly<Record<DeviceKind, readonly CapabilityType[]>> = {
  light: ['power'],
  switch: ['power'],
  plug: ['power'],
  fan: ['power'],
  climate: ['climate', 'power'],
  cover: ['cover'],
  valve: ['valve'],
  lock: ['lock'],
  media: ['media', 'power'],
  vacuum: ['vacuum'],
  humidifier: ['humidifier', 'power'],
  water_heater: ['water_heater', 'power'],
  alarm: ['alarm'],
  mower: ['mower'],
  sensor: [],
  other: [],
};

/** For a device whose kind did not decide (an `other`, or a kind without its capability). */
const FALLBACK: readonly CapabilityType[] = [
  'climate',
  'media',
  'vacuum',
  'mower',
  'alarm',
  'lock',
  'cover',
  'valve',
  'humidifier',
  'water_heater',
  'power',
];

/** Main controls that carry the device's Power button inside them. */
const WITH_POWER: ReadonlySet<CapabilityType> = new Set(['climate', 'media', 'humidifier', 'water_heater']);

/** The order controls are listed in under "More controls" and "More settings"; options by their role. */
const ORDER: readonly string[] = [
  'power',
  'brightness',
  'color',
  'color_temp',
  'option:effect',
  'fan',
  'climate',
  'humidifier',
  'water_heater',
  'cover',
  'valve',
  'media',
  'vacuum',
  'mower',
  'lock',
  'alarm',
  'option:activity',
  'number',
  'option:setting',
  'press',
];

const rank = (capability: Capability) => ORDER.indexOf(capability.type === 'option' ? `option:${capability.role}` : capability.type);

const byRank = (list: readonly Capability[]) =>
  list
    .map((capability, index) => ({ capability, index }))
    .sort((a, b) => rank(a.capability) - rank(b.capability) || a.index - b.index)
    .map((entry) => entry.capability);

export function planControls(device: Pick<Device, 'kind' | 'capabilities'>): ControlPlan {
  const everyday = device.capabilities.filter((capability) => !capability.advanced);
  const order = [...MAIN_BY_KIND[device.kind], ...FALLBACK];
  let main: Capability | null = null;
  for (const type of order) {
    main = everyday.find((capability) => capability.type === type) ?? null;
    if (main) break;
  }
  // A TV's remote keys only ever appear on its remote, never in a list of buttons (settings included).
  const remote =
    main?.type === 'media' || device.kind === 'media'
      ? device.capabilities.filter((capability): capability is PressCapability => capability.type === 'press' && remoteKeyOf(capability.entityId) !== null)
      : [];
  // Its remote is drawn with the Power key: a TV that reports only power still gets its remote.
  if (main === null && remote.length > 0) main = remote[0];
  const powers = everyday.filter((capability): capability is PowerCapability => capability.type === 'power' && capability !== main);
  const mainPower =
    !main ? [] : main.type === 'power' ? powers : WITH_POWER.has(main.type) || main.type === 'press' ? powers.slice(0, 1) : [];
  const taken = new Set<Capability>([...(main ? [main] : []), ...mainPower, ...remote]);
  const more = byRank(everyday.filter((capability) => !taken.has(capability)));
  const settings = byRank(device.capabilities.filter((capability) => capability.advanced && !taken.has(capability)));
  return { main, mainPower, remote, more, settings };
}

/** Whether the device's main control is a TV remote: it has remote keys (Up, OK, Back…). */
export const isTvRemote = (plan: ControlPlan) => plan.remote.length > 0;

/** The keys a TV remote has, as the gateway names them (gateway/cube_gateway/adapters/webos.py REMOTE_KEYS). */
export const REMOTE_KEYS = ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'menu', 'channel_up', 'channel_down', 'info', 'exit'] as const;

export type RemoteKey = (typeof REMOTE_KEYS)[number];

/** Which remote key a button is (`up`, `remote:ok`, `key_back`…), or null for any other button. */
export function remoteKeyOf(entityId: string): RemoteKey | null {
  const name = (entityId.split(/[:.]/).pop() ?? '').toLowerCase().replace(/^key_/, '');
  return (REMOTE_KEYS as readonly string[]).includes(name) ? (name as RemoteKey) : null;
}

/**
 * Whether the main capability has controls beyond its main block (an AC's fan speed and
 * swing, a TV's sound mode), which then lead "More controls".
 */
export function hasExtras(capability: Capability): boolean {
  switch (capability.type) {
    case 'climate':
      return capability.fanModes.length > 0 || capability.swingModes.length > 0 || capability.presetModes.length > 0 || capability.targetHumidity !== null;
    case 'media':
      return capability.volume !== null || capability.canStop || capability.soundModes.length > 0 || capability.shuffle !== null || capability.repeat !== null;
    case 'cover':
      return capability.canTilt || capability.canSetTilt;
    case 'vacuum':
      return capability.fanSpeeds.length > 0 || capability.canStop || capability.canLocate || capability.canSpot;
    case 'water_heater':
      return capability.away !== null;
    default:
      return false;
  }
}

/** Up to six choices sit as big chips; more go in a list that scrolls. */
export const MAX_CHIPS = 6;

export const optionsLayout = (count: number): 'chips' | 'list' => (count <= MAX_CHIPS ? 'chips' : 'list');

/** A number with twenty steps or fewer gets − / + buttons; a longer range a slider. */
export const numberLayout = (capability: Pick<NumberCapability, 'min' | 'max' | 'step'>): 'stepper' | 'slider' =>
  capability.step > 0 && (capability.max - capability.min) / capability.step <= 20 ? 'stepper' : 'slider';

/** One step up or down from `value`, kept on the step's grid and inside min–max. */
export function stepValue(value: number, direction: 1 | -1, step: number, min: number, max: number): number {
  const size = step > 0 ? step : 1;
  const next = Math.round((value + direction * size) / size) * size;
  return Number(Math.min(max, Math.max(min, next)).toFixed(4));
}

export interface FanSpeed {
  label: string;
  percentage: number;
}

const SPEED_NAMES: Readonly<Record<number, readonly string[]>> = {
  2: ['Low', 'High'],
  3: ['Low', 'Medium', 'High'],
  4: ['Low', 'Medium', 'High', 'Highest'],
};

/**
 * A fan with a few real speeds (Home Assistant's percentage step) gets one button per
 * speed; a fan with many gets a slider (null).
 */
export function fanSpeeds(capability: Pick<FanCapability, 'percentageStep'>): FanSpeed[] | null {
  const step = capability.percentageStep;
  if (!(step > 0)) return null;
  const count = Math.round(100 / step);
  if (count < 2 || count > MAX_CHIPS) return null;
  const names = SPEED_NAMES[count];
  return Array.from({ length: count }, (_, index) => ({
    label: names?.[index] ?? `Speed ${index + 1}`,
    percentage: index === count - 1 ? 100 : Math.round((index + 1) * step),
  }));
}

/** The speed button nearest the fan's percentage, or null while it is off. */
export function currentFanSpeed(speeds: readonly FanSpeed[], percentage: number | null): FanSpeed | null {
  if (percentage === null || percentage <= 0) return null;
  return speeds.reduce((best, speed) => (Math.abs(speed.percentage - percentage) < Math.abs(best.percentage - percentage) ? speed : best));
}

/** How much one press of Volume − / + moves a set level when the device has no volume step of its own. */
export const VOLUME_STEP = 0.05;

/**
 * What Volume − / + sends: the device's own volume step when it has one, else the set
 * level moved by 5%; null when the device can do neither.
 */
export function volumeCommand(media: MediaCapability, direction: 1 | -1): { action: string; value?: number } | null {
  if (media.canVolumeStep) return { action: direction > 0 ? 'volume_up' : 'volume_down' };
  if (media.volume !== null) {
    return { action: 'set_volume', value: Number(Math.min(1, Math.max(0, media.volume + direction * VOLUME_STEP)).toFixed(2)) };
  }
  return null;
}

/** What the Play / Pause key sends, by what the player is doing; null when it can do neither. */
export function playPauseAction(media: MediaCapability): 'play' | 'pause' | 'play_pause' | 'stop' | null {
  if (media.state === 'playing' || media.state === 'buffering') return media.canPause ? 'pause' : media.canStop ? 'stop' : null;
  if (['paused', 'idle', 'on', 'off', 'standby'].includes(media.state)) return media.canPlay ? 'play' : null;
  if (media.canPlay && media.canPause) return 'play_pause';
  return media.canPlay ? 'play' : media.canPause ? 'pause' : null;
}

/**
 * The Power button of an air conditioner without a power switch of its own: Off is its
 * `off` mode, On the mode the card's switch uses (climateOnMode). Null when it has no off.
 */
export function climatePowerCommand(modes: readonly string[], entityId: string, on: boolean): Command | null {
  const mode = on ? climateOnMode(modes) : modes.includes('off') ? 'off' : null;
  return mode && modes.includes('off') ? { capability: 'climate', action: 'set_mode', value: mode, entityId } : null;
}
