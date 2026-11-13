import { ApiError } from '../errors.ts';
import { domainOf } from './mapping.ts';
import type { Capability, CapabilityType, CommandRequest, Device } from './types.ts';

/**
 * The only Home Assistant services the app can reach. A command names a
 * capability the device has and one of that capability's actions; this
 * turns it into one service call, with values checked and clamped against
 * what the entity reports. Nothing else (arbitrary domains, services or
 * service data) is ever forwarded, so a resident cannot use the facade's
 * admin token for anything but driving their own devices.
 *
 * Every service below is a fixed name; values only ever fill fixed data keys,
 * and a choice must be one of the entity's own lists. An action the
 * capability says the device can't do (a false `can…`, a null value or an
 * empty list) is refused with `not_available` before Home Assistant sees it.
 */

export interface ServiceCall {
  domain: string;
  service: string;
  entityId: string;
  data: Record<string, unknown>;
}

type Build = (value: unknown, capability: Capability) => { service: string; data?: Record<string, unknown> };

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('bad_request', `${what} must be a number.`);
  }
  return value;
}

export function oneOf(value: unknown, options: readonly string[], what: string): string {
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new ApiError('bad_request', `${what} must be one of: ${options.join(', ') || '(none available)'}.`);
  }
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiError('bad_request', `${what} takes true or false.`);
  }
  return value;
}

/** Refuses an action the device can't do. */
function need(can: boolean, message: string) {
  if (!can) {
    throw new ApiError('not_available', message);
  }
}

/** One of the entity's own options; an entity without any can't make the choice at all. */
function pick(value: unknown, options: readonly string[], what: string, missing: string): string {
  need(options.length > 0, missing);
  return oneOf(value, options, what);
}

const decimalsOf = (value: number) => {
  const [digits, exponent] = String(value).split('e-');
  return (digits.split('.')[1]?.length ?? 0) + (exponent ? Number(exponent) : 0);
};

/** Clamped to min–max and rounded to the nearest step from min, as Home Assistant's number entities take it. */
export function snap(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  if (!(step > 0)) {
    return clamped;
  }
  const decimals = Math.min(12, Math.max(decimalsOf(step), decimalsOf(min)));
  const snapped = Number((min + Math.round((clamped - min) / step) * step).toFixed(decimals));
  return snapped > max ? Number((snapped - step).toFixed(decimals)) : snapped;
}

/** An alarm code: optional, at most 32 characters. It goes to Home Assistant only: never stored, logged or audited. */
function alarmCode(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) {
    throw new ApiError('bad_request', 'The alarm code must be text of 1 to 32 characters.');
  }
  return value;
}

/** The alarm's arm and disarm values: `{ mode, code? }` and `{ code? }` (a bare mode string is taken too). */
function alarmValue(value: unknown): { mode?: unknown; code?: unknown } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value === 'string') {
    return { mode: value };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('bad_request', 'The alarm takes { mode, code? }.');
  }
  return value as { mode?: unknown; code?: unknown };
}

const ALARM_ARM_SERVICES: Record<string, string> = {
  home: 'alarm_arm_home',
  away: 'alarm_arm_away',
  night: 'alarm_arm_night',
  vacation: 'alarm_arm_vacation',
  custom_bypass: 'alarm_arm_custom_bypass',
};

const REPEAT_MODES = ['off', 'one', 'all'];
const DIRECTIONS = ['forward', 'reverse'];

const as = <T extends CapabilityType>(capability: Capability, type: T) => capability as Extract<Capability, { type: T }>;

const RULES: Record<CapabilityType, Record<string, Build>> = {
  power: {
    on: () => ({ service: 'turn_on' }),
    off: () => ({ service: 'turn_off' }),
    // Water heaters have turn_on / turn_off but no toggle service.
    toggle: (_value, capability) =>
      domainOf(capability.entityId) === 'water_heater'
        ? { service: as(capability, 'power').value === 'on' ? 'turn_off' : 'turn_on' }
        : { service: 'toggle' },
  },
  brightness: {
    set: (value) => {
      const pct = Math.round(clamp(number(value, 'Brightness'), 0, 100));
      return pct === 0 ? { service: 'turn_off' } : { service: 'turn_on', data: { brightness_pct: pct } };
    },
  },
  color_temp: {
    set: (value, capability) => {
      const { min, max } = as(capability, 'color_temp');
      return { service: 'turn_on', data: { color_temp_kelvin: Math.round(clamp(number(value, 'Colour temperature'), min, max)) } };
    },
  },
  color: {
    set: (value) => {
      const hs = value as { h?: unknown; s?: unknown } | null;
      if (!hs || typeof hs !== 'object') {
        throw new ApiError('bad_request', 'Colour must be { h, s }.');
      }
      return { service: 'turn_on', data: { hs_color: [clamp(number(hs.h, 'Hue'), 0, 360), clamp(number(hs.s, 'Saturation'), 0, 100)] } };
    },
  },
  climate: {
    set_temperature: (value, capability) => {
      const { min, max, target } = as(capability, 'climate');
      need(target !== null, 'This device has no target temperature.');
      return { service: 'set_temperature', data: { temperature: clamp(number(value, 'Temperature'), min, max) } };
    },
    set_temperature_range: (value, capability) => {
      const { min, max, targetLow, targetHigh } = as(capability, 'climate');
      need(targetLow !== null || targetHigh !== null, 'This device has no temperature range.');
      const range = value as { low?: unknown; high?: unknown } | null;
      if (!range || typeof range !== 'object') {
        throw new ApiError('bad_request', 'The range must be { low, high }.');
      }
      const low = clamp(number(range.low, 'Low'), min, max);
      const high = clamp(number(range.high, 'High'), min, max);
      if (low > high) {
        throw new ApiError('bad_request', 'Low must not be above high.');
      }
      return { service: 'set_temperature', data: { target_temp_low: low, target_temp_high: high } };
    },
    set_mode: (value, capability) => ({
      service: 'set_hvac_mode',
      data: { hvac_mode: pick(value, as(capability, 'climate').modes, 'Mode', 'This device has no modes.') },
    }),
    set_fan_mode: (value, capability) => ({
      service: 'set_fan_mode',
      data: { fan_mode: pick(value, as(capability, 'climate').fanModes, 'Fan mode', 'This device has no fan modes.') },
    }),
    set_preset: (value, capability) => ({
      service: 'set_preset_mode',
      data: { preset_mode: pick(value, as(capability, 'climate').presetModes, 'Preset', 'This device has no presets.') },
    }),
    set_swing_mode: (value, capability) => ({
      service: 'set_swing_mode',
      data: { swing_mode: pick(value, as(capability, 'climate').swingModes, 'Swing mode', 'This device cannot swing.') },
    }),
    set_humidity: (value, capability) => {
      const { targetHumidity, minHumidity, maxHumidity } = as(capability, 'climate');
      need(targetHumidity !== null, 'This device has no target humidity.');
      return { service: 'set_humidity', data: { humidity: Math.round(clamp(number(value, 'Humidity'), minHumidity, maxHumidity)) } };
    },
  },
  cover: {
    open: () => ({ service: 'open_cover' }),
    close: () => ({ service: 'close_cover' }),
    stop: (_value, capability) => {
      need(as(capability, 'cover').canStop, 'This cover cannot stop part way.');
      return { service: 'stop_cover' };
    },
    set_position: (value, capability) => {
      need(as(capability, 'cover').canPosition, 'This cover cannot be set to a position.');
      return { service: 'set_cover_position', data: { position: Math.round(clamp(number(value, 'Position'), 0, 100)) } };
    },
    open_tilt: (_value, capability) => {
      need(as(capability, 'cover').canTilt, 'This cover does not tilt.');
      return { service: 'open_cover_tilt' };
    },
    close_tilt: (_value, capability) => {
      need(as(capability, 'cover').canTilt, 'This cover does not tilt.');
      return { service: 'close_cover_tilt' };
    },
    // The contract has no flag of its own for stopping the tilt: a cover that tilts and stops is let through.
    stop_tilt: (_value, capability) => {
      const { canTilt, canStop } = as(capability, 'cover');
      need(canTilt && canStop, 'This cover cannot stop its tilt part way.');
      return { service: 'stop_cover_tilt' };
    },
    set_tilt: (value, capability) => {
      need(as(capability, 'cover').canSetTilt, 'This cover cannot be set to a tilt.');
      return { service: 'set_cover_tilt_position', data: { tilt_position: Math.round(clamp(number(value, 'Tilt'), 0, 100)) } };
    },
  },
  lock: {
    lock: () => ({ service: 'lock' }),
    unlock: () => ({ service: 'unlock' }),
    open: (_value, capability) => {
      need(as(capability, 'lock').canOpen, 'This lock cannot unlatch the door.');
      return { service: 'open' };
    },
  },
  fan: {
    set_percentage: (value, capability) => {
      need(as(capability, 'fan').percentage !== null, 'This fan has no speed control.');
      return { service: 'set_percentage', data: { percentage: Math.round(clamp(number(value, 'Speed'), 0, 100)) } };
    },
    set_preset: (value, capability) => ({
      service: 'set_preset_mode',
      data: { preset_mode: pick(value, as(capability, 'fan').presetModes, 'Preset', 'This fan has no presets.') },
    }),
    set_oscillating: (value, capability) => {
      need(as(capability, 'fan').oscillating !== null, 'This fan cannot oscillate.');
      return { service: 'oscillate', data: { oscillating: bool(value, 'Oscillating') } };
    },
    set_direction: (value, capability) => {
      need(as(capability, 'fan').direction !== null, 'This fan cannot change direction.');
      return { service: 'set_direction', data: { direction: oneOf(value, DIRECTIONS, 'Direction') } };
    },
  },
  media: {
    play: (_value, capability) => {
      need(as(capability, 'media').canPlay, 'This player cannot play.');
      return { service: 'media_play' };
    },
    pause: (_value, capability) => {
      need(as(capability, 'media').canPause, 'This player cannot pause.');
      return { service: 'media_pause' };
    },
    // Home Assistant's media_play_pause needs both features.
    play_pause: (_value, capability) => {
      const { canPlay, canPause } = as(capability, 'media');
      need(canPlay && canPause, 'This player cannot play and pause.');
      return { service: 'media_play_pause' };
    },
    stop: (_value, capability) => {
      need(as(capability, 'media').canStop, 'This player cannot stop.');
      return { service: 'media_stop' };
    },
    next: (_value, capability) => {
      need(as(capability, 'media').canNext, 'This player cannot skip ahead.');
      return { service: 'media_next_track' };
    },
    previous: (_value, capability) => {
      need(as(capability, 'media').canPrevious, 'This player cannot go back.');
      return { service: 'media_previous_track' };
    },
    set_volume: (value, capability) => {
      need(as(capability, 'media').volume !== null, 'This player has no volume control.');
      return { service: 'volume_set', data: { volume_level: clamp(number(value, 'Volume'), 0, 1) } };
    },
    volume_up: (_value, capability) => {
      need(as(capability, 'media').canVolumeStep, 'This player has no volume control.');
      return { service: 'volume_up' };
    },
    volume_down: (_value, capability) => {
      need(as(capability, 'media').canVolumeStep, 'This player has no volume control.');
      return { service: 'volume_down' };
    },
    mute: (value, capability) => {
      need(as(capability, 'media').muted !== null, 'This player cannot be muted.');
      return { service: 'volume_mute', data: { is_volume_muted: bool(value, 'Mute') } };
    },
    select_source: (value, capability) => ({
      service: 'select_source',
      data: { source: pick(value, as(capability, 'media').sources, 'Source', 'This player has no sources to choose from.') },
    }),
    select_sound_mode: (value, capability) => ({
      service: 'select_sound_mode',
      data: { sound_mode: pick(value, as(capability, 'media').soundModes, 'Sound mode', 'This player has no sound modes.') },
    }),
    set_shuffle: (value, capability) => {
      need(as(capability, 'media').shuffle !== null, 'This player cannot shuffle.');
      return { service: 'shuffle_set', data: { shuffle: bool(value, 'Shuffle') } };
    },
    set_repeat: (value, capability) => {
      need(as(capability, 'media').repeat !== null, 'This player cannot repeat.');
      return { service: 'repeat_set', data: { repeat: oneOf(value, REPEAT_MODES, 'Repeat') } };
    },
  },
  press: {
    press: () => ({ service: 'press' }),
  },
  option: {
    // One action, three services: a select entity's own option, a light's effect, a remote's activity.
    select: (value, capability) => {
      const choice = pick(value, as(capability, 'option').options, 'Option', 'There is nothing to choose from.');
      switch (domainOf(capability.entityId)) {
        case 'select':
        case 'input_select':
          return { service: 'select_option', data: { option: choice } };
        case 'light':
          return { service: 'turn_on', data: { effect: choice } };
        case 'remote':
          return { service: 'turn_on', data: { activity: choice } };
        default:
          throw new ApiError('not_available', 'This device cannot do that.');
      }
    },
  },
  number: {
    set: (value, capability) => {
      const { min, max, step } = as(capability, 'number');
      return { service: 'set_value', data: { value: snap(number(value, 'Value'), min, max, step) } };
    },
  },
  vacuum: {
    start: () => ({ service: 'start' }),
    pause: (_value, capability) => {
      need(as(capability, 'vacuum').canPause, 'This vacuum cannot pause.');
      return { service: 'pause' };
    },
    stop: (_value, capability) => {
      need(as(capability, 'vacuum').canStop, 'This vacuum cannot stop.');
      return { service: 'stop' };
    },
    return_to_base: (_value, capability) => {
      need(as(capability, 'vacuum').canReturn, 'This vacuum cannot go back to its dock.');
      return { service: 'return_to_base' };
    },
    locate: (_value, capability) => {
      need(as(capability, 'vacuum').canLocate, 'This vacuum cannot be located.');
      return { service: 'locate' };
    },
    clean_spot: (_value, capability) => {
      need(as(capability, 'vacuum').canSpot, 'This vacuum cannot clean a spot.');
      return { service: 'clean_spot' };
    },
    set_fan_speed: (value, capability) => ({
      service: 'set_fan_speed',
      data: { fan_speed: pick(value, as(capability, 'vacuum').fanSpeeds, 'Suction', 'This vacuum has one suction level.') },
    }),
  },
  humidifier: {
    set_humidity: (value, capability) => {
      const { min, max } = as(capability, 'humidifier');
      return { service: 'set_humidity', data: { humidity: Math.round(clamp(number(value, 'Humidity'), min, max)) } };
    },
    set_mode: (value, capability) => ({
      service: 'set_mode',
      data: { mode: pick(value, as(capability, 'humidifier').modes, 'Mode', 'This device has no modes.') },
    }),
  },
  water_heater: {
    set_temperature: (value, capability) => {
      const { min, max, target } = as(capability, 'water_heater');
      need(target !== null, 'This heater has no target temperature.');
      return { service: 'set_temperature', data: { temperature: clamp(number(value, 'Temperature'), min, max) } };
    },
    set_mode: (value, capability) => ({
      service: 'set_operation_mode',
      data: { operation_mode: pick(value, as(capability, 'water_heater').modes, 'Mode', 'This heater has no modes.') },
    }),
    set_away: (value, capability) => {
      need(as(capability, 'water_heater').away !== null, 'This heater has no away mode.');
      return { service: 'set_away_mode', data: { away_mode: bool(value, 'Away') } };
    },
  },
  valve: {
    open: () => ({ service: 'open_valve' }),
    close: () => ({ service: 'close_valve' }),
    stop: (_value, capability) => {
      need(as(capability, 'valve').canStop, 'This valve cannot stop part way.');
      return { service: 'stop_valve' };
    },
    set_position: (value, capability) => {
      need(as(capability, 'valve').canPosition, 'This valve cannot be set to a position.');
      return { service: 'set_valve_position', data: { position: Math.round(clamp(number(value, 'Position'), 0, 100)) } };
    },
  },
  alarm: {
    arm: (value, capability) => {
      const { mode, code } = alarmValue(value);
      const chosen = pick(mode, as(capability, 'alarm').modes, 'Mode', 'This alarm cannot be armed from here.');
      const given = alarmCode(code);
      // Panels that want the code only to disarm (code_arm_required false) arm without it; Home Assistant checks.
      return { service: ALARM_ARM_SERVICES[chosen], data: given === undefined ? {} : { code: given } };
    },
    disarm: (value, capability) => {
      const given = alarmCode(alarmValue(value).code);
      if (given === undefined && as(capability, 'alarm').codeRequired) {
        throw new ApiError('bad_request', 'This alarm needs its code to disarm.');
      }
      return { service: 'alarm_disarm', data: given === undefined ? {} : { code: given } };
    },
  },
  mower: {
    start: () => ({ service: 'start_mowing' }),
    pause: (_value, capability) => {
      need(as(capability, 'mower').canPause, 'This mower cannot pause.');
      return { service: 'pause' };
    },
    dock: (_value, capability) => {
      need(as(capability, 'mower').canDock, 'This mower cannot go back to its dock.');
      return { service: 'dock' };
    },
  },
};

/**
 * Actions (Home Assistant `domain.service`, as hubRuntime.ts names them) that are written to the audit log: opening a
 * door and arming or disarming the alarm. Every command from the assistant is, too.
 */
export const AUDITED = new Set([
  'lock.unlock',
  'lock.open',
  'alarm_control_panel.alarm_disarm',
  ...Object.values(ALARM_ARM_SERVICES).map((service) => `alarm_control_panel.${service}`),
]);

/** Where a command came from: the resident's own tap, or the Parklane Assistant acting for them. */
export type CommandSource = 'app' | 'assistant';

/**
 * What the assistant may not do, with the reason it is told: a door opens and the alarm goes off only with the
 * resident's own tap in the app. Keyed like AUDITED.
 */
export const ASSISTANT_REFUSED: ReadonlyMap<string, string> = new Map([
  ['lock.unlock', 'For safety, doors can only be unlocked from the app.'],
  ['lock.open', 'For safety, doors can only be opened from the app.'],
  ['alarm_control_panel.alarm_disarm', 'For safety, the alarm can only be disarmed from the app.'],
]);

/** The one service call a command maps to, or a 4xx ApiError. */
export function resolveCommand(device: Device, request: CommandRequest): { call: ServiceCall; capability: Capability } {
  if (!Object.hasOwn(RULES, request.capability)) {
    throw new ApiError('bad_request', 'Unknown capability.');
  }
  const rules = RULES[request.capability];
  const build = Object.hasOwn(rules, request.action) ? rules[request.action] : undefined;
  if (!build) {
    throw new ApiError('bad_request', `Unknown action for ${request.capability}.`);
  }
  const matching = device.capabilities.filter(
    (entry) => entry.type === request.capability && (request.entityId === undefined || entry.entityId === request.entityId),
  );
  // Without an entityId, the everyday control wins over a setting of the same type (a plug's power, not its child lock).
  const capability = matching.find((entry) => !entry.advanced) ?? matching[0];
  if (!capability) {
    throw new ApiError('not_available', 'This device cannot do that.');
  }
  const { service, data = {} } = build(request.value, capability);
  return { call: { domain: domainOf(capability.entityId), service, entityId: capability.entityId, data }, capability };
}

/** Reads a command from a request body; resolveCommand checks it against the device. */
export function parseCommand(body: Record<string, unknown>): CommandRequest {
  const { capability, action, value, entityId } = body;
  if (typeof capability !== 'string' || typeof action !== 'string') {
    throw new ApiError('bad_request', 'capability and action are required.');
  }
  if (entityId !== undefined && typeof entityId !== 'string') {
    throw new ApiError('bad_request', 'entityId must be a string.');
  }
  return { capability: capability as CapabilityType, action, value, entityId };
}
