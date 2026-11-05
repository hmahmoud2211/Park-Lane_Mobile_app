import { ApiError } from '../errors.ts';
import type { Capability, CommandRequest, DeviceKind, SensorReading } from '../ha/types.ts';

/**
 * What a Tasmota device says over MQTT, read into the facade's device shape,
 * and the app's commands written as Tasmota commands. Pure: no sockets or
 * storage, so it is tested on its own (test/direct.test.ts).
 *
 * The device's topic is its MQTT username, with Tasmota's default FullTopic
 * `%prefix%/%topic%/`:
 *
 *   cmnd/<topic>/POWER1 ON          the backend asks
 *   stat/<topic>/RESULT {…}         the device answers every command, and reports changes
 *   stat/<topic>/POWER1 ON          …and each relay's new state on its own
 *   stat/<topic>/STATUS… {…}        names, firmware and MAC (STATUS, STATUS2, STATUS5, or STATUS0)
 *   tele/<topic>/STATE {…}          the full state, every TelePeriod
 *   tele/<topic>/SENSOR {…}         readings (energy, temperature…), every TelePeriod
 *   tele/<topic>/INFO1 {…}          module and firmware, on every connect
 *   tasmota/discovery/<MAC>/config  the same, on firmware with discovery (SetOption19 0)
 *
 * Commands are allowlisted like the hub's (ha/commands.ts): power, a
 * dimmer, colour temperature and colour. Nothing else reaches the device.
 */

export type DirectKind = 'plug' | 'switch' | 'light';
export const DIRECT_KINDS: readonly DirectKind[] = ['plug', 'switch', 'light'];

export interface TasmotaState {
  /** POWER, or POWER1…POWER8 on devices with several relays. */
  power: Map<string, 'on' | 'off'>;
  dimmer: number | null;
  /** Colour temperature in mireds, as Tasmota keeps it (153–500). */
  ct: number | null;
  hsb: { h: number; s: number; b: number } | null;
  /** The device's FriendlyName per relay; '' where it has none. */
  names: string[];
  model: string | null;
  firmware: string | null;
  mac: string | null;
  sensors: Map<string, SensorReading>;
}

export const emptyState = (): TasmotaState => ({
  power: new Map(),
  dimmer: null,
  ct: null,
  hsb: null,
  names: [],
  model: null,
  firmware: null,
  mac: null,
  sensors: new Map(),
});

export interface MessageEffect {
  /** Something the app shows changed. */
  changed: boolean;
  /** The answer to a command (stat/<topic>/RESULT or POWERn), for the command waiting on it. */
  result: Record<string, unknown> | null;
  /** The device told its model, firmware or MAC, which are kept with it. */
  identity: boolean;
}

const NOTHING: MessageEffect = { changed: false, result: null, identity: false };

const MIRED_MIN = 153;
const MIRED_MAX = 500;
const kelvinOf = (mired: number) => Math.round(1_000_000 / mired);
const KELVIN_MIN = kelvinOf(MIRED_MAX);
const KELVIN_MAX = kelvinOf(MIRED_MIN);

const POWER_KEY = /^POWER(\d*)$/;
const STATUS_KEY = /^STATUS\d*$/;
const INFO_KEY = /^INFO\d$/;

type Json = Record<string, unknown>;

function json(payload: Buffer): Json | null {
  try {
    const value: unknown = JSON.parse(payload.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const object = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const onOff = (value: unknown): 'on' | 'off' | null => (value === 'ON' ? 'on' : value === 'OFF' ? 'off' : null);

/** Power, dimmer and colour from RESULT, STATE or StatusSTS. */
function applyStateJson(state: TasmotaState, data: Json): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    const power = POWER_KEY.test(key) ? onOff(value) : null;
    if (power && state.power.get(key) !== power) {
      state.power.set(key, power);
      changed = true;
    }
  }
  const dimmer = finite(data.Dimmer);
  if (dimmer !== null && dimmer !== state.dimmer) {
    state.dimmer = dimmer;
    changed = true;
  }
  const ct = finite(data.CT);
  if (ct !== null && ct !== state.ct) {
    state.ct = ct;
    changed = true;
  }
  const hsb = text(data.HSBColor)?.split(',').map(Number);
  if (hsb && hsb.length === 3 && hsb.every(Number.isFinite)) {
    const [h, s, b] = hsb;
    if (!state.hsb || state.hsb.h !== h || state.hsb.s !== s || state.hsb.b !== b) {
      state.hsb = { h, s, b };
      changed = true;
    }
  }
  return changed;
}

/** Labels for the readings of Tasmota's energy monitor. */
const ENERGY_LABELS: Record<string, string> = {
  Power: 'Power',
  ApparentPower: 'Apparent power',
  ReactivePower: 'Reactive power',
  Factor: 'Power factor',
  Voltage: 'Voltage',
  Current: 'Current',
  Today: 'Energy today',
  Yesterday: 'Energy yesterday',
  Total: 'Energy total',
};

/** Units and device classes by reading name; temperatures take the device's TempUnit. */
const READINGS: Record<string, { unit: string | null; deviceClass: string }> = {
  Power: { unit: 'W', deviceClass: 'power' },
  ApparentPower: { unit: 'VA', deviceClass: 'apparent_power' },
  ReactivePower: { unit: 'var', deviceClass: 'reactive_power' },
  Factor: { unit: null, deviceClass: 'power_factor' },
  Voltage: { unit: 'V', deviceClass: 'voltage' },
  Current: { unit: 'A', deviceClass: 'current' },
  Today: { unit: 'kWh', deviceClass: 'energy' },
  Yesterday: { unit: 'kWh', deviceClass: 'energy' },
  Total: { unit: 'kWh', deviceClass: 'energy' },
  Temperature: { unit: '°', deviceClass: 'temperature' },
  DewPoint: { unit: '°', deviceClass: 'temperature' },
  Humidity: { unit: '%', deviceClass: 'humidity' },
  Pressure: { unit: 'hPa', deviceClass: 'pressure' },
  Illuminance: { unit: 'lx', deviceClass: 'illuminance' },
};

/** Every number in tele/SENSOR (or StatusSNS), one reading each: `{"ENERGY":{"Power":12}}` is ENERGY.Power. */
function applySensors(state: TasmotaState, data: Json): boolean {
  let changed = false;
  const tempUnit = text(data.TempUnit) ?? 'C';
  for (const [sensor, fields] of Object.entries(data)) {
    const values = object(fields);
    if (!values) {
      continue;
    }
    for (const [field, raw] of Object.entries(values)) {
      const value = finite(raw);
      if (value === null) {
        continue;
      }
      const known = READINGS[field];
      const entityId = `${sensor}.${field}`;
      const reading: SensorReading = {
        entityId,
        label: sensor === 'ENERGY' ? (ENERGY_LABELS[field] ?? field) : `${sensor} ${field}`,
        value: String(value),
        unit: known?.unit === '°' ? `°${tempUnit}` : (known?.unit ?? null),
        deviceClass: known?.deviceClass ?? null,
      };
      if (state.sensors.get(entityId)?.value !== reading.value) {
        state.sensors.set(entityId, reading);
        changed = true;
      }
    }
  }
  return changed;
}

function setIdentity(state: TasmotaState, fields: { model?: unknown; firmware?: unknown; mac?: unknown }): boolean {
  let identity = false;
  for (const key of ['model', 'firmware', 'mac'] as const) {
    const value = text(fields[key]);
    if (value && state[key] !== value) {
      state[key] = value;
      identity = true;
    }
  }
  return identity;
}

function setNames(state: TasmotaState, value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const names = value.map((name) => text(name) ?? '');
  if (names.join('\n') === state.names.join('\n')) {
    return false;
  }
  state.names = names;
  return true;
}

/** STATUS, STATUS2, STATUS5, STATUS11…, or all of them at once as STATUS0 does. */
function applyStatus(state: TasmotaState, data: Json): MessageEffect {
  let changed = setNames(state, object(data.Status)?.FriendlyName);
  const identity = setIdentity(state, {
    firmware: object(data.StatusFWR)?.Version,
    mac: object(data.StatusNET)?.Mac,
  });
  const sts = object(data.StatusSTS);
  if (sts) changed = applyStateJson(state, sts) || changed;
  const sns = object(data.StatusSNS);
  if (sns) changed = applySensors(state, sns) || changed;
  return { changed: changed || identity, result: null, identity };
}

/** Applies one message the device sent; `topic` is its own MQTT username. */
export function applyMessage(state: TasmotaState, topic: string, messageTopic: string, payload: Buffer): MessageEffect {
  const parts = messageTopic.split('/');
  if (parts[0] === 'tasmota' && parts[1] === 'discovery' && parts.length === 4) {
    const data = json(payload);
    if (!data) return NOTHING;
    if (parts[3] === 'config') {
      const named = setNames(state, data.fn);
      const identity = setIdentity(state, { model: data.md, firmware: data.sw, mac: data.mac });
      return { changed: named || identity, result: null, identity };
    }
    const sensors = object(data.sn);
    return sensors ? { changed: applySensors(state, sensors), result: null, identity: false } : NOTHING;
  }
  if (parts.length !== 3 || parts[1] !== topic) {
    return NOTHING;
  }
  const [prefix, , name] = parts;
  if (prefix === 'stat' && name === 'RESULT') {
    const data = json(payload);
    return data ? { changed: applyStateJson(state, data), result: data, identity: false } : NOTHING;
  }
  if (prefix === 'stat' && POWER_KEY.test(name)) {
    const value = payload.toString('utf8').trim();
    return { changed: applyStateJson(state, { [name]: value }), result: { [name]: value }, identity: false };
  }
  if (prefix === 'stat' && STATUS_KEY.test(name)) {
    const data = json(payload);
    return data ? applyStatus(state, data) : NOTHING;
  }
  if (prefix === 'tele' && name === 'STATE') {
    const data = json(payload);
    return data ? { changed: applyStateJson(state, data), result: null, identity: false } : NOTHING;
  }
  if (prefix === 'tele' && name === 'SENSOR') {
    const data = json(payload);
    return data ? { changed: applySensors(state, data), result: null, identity: false } : NOTHING;
  }
  if (prefix === 'tele' && INFO_KEY.test(name)) {
    // Newer firmware nests it: {"Info1":{"Module":…,"Version":…}}.
    const data = json(payload);
    const info = object(data?.Info1) ?? data;
    const identity = info ? setIdentity(state, { model: info.Module, firmware: info.Version }) : false;
    return { changed: identity, result: null, identity };
  }
  return NOTHING;
}

// ---- The facade's view -------------------------------------------------------------------

const relayIndex = (key: string) => Number(key.slice('POWER'.length)) || 1;

export function capabilitiesOf(state: TasmotaState): Capability[] {
  const keys = [...state.power.keys()].sort((a, b) => relayIndex(a) - relayIndex(b));
  const capabilities: Capability[] = keys.map((key) => {
    const index = relayIndex(key);
    const label = state.names[index - 1] || (keys.length > 1 ? `Switch ${index}` : 'Power');
    return { type: 'power', entityId: key, label, value: state.power.get(key) ?? 'unknown' };
  });
  if (state.dimmer !== null) {
    capabilities.push({ type: 'brightness', entityId: 'Dimmer', label: 'Brightness', value: state.dimmer });
  }
  if (state.ct !== null) {
    capabilities.push({ type: 'color_temp', entityId: 'CT', label: 'Colour temperature', value: kelvinOf(state.ct), min: KELVIN_MIN, max: KELVIN_MAX });
  }
  if (state.hsb) {
    capabilities.push({ type: 'color', entityId: 'HSBColor', label: 'Colour', value: { h: state.hsb.h, s: state.hsb.s } });
  }
  return capabilities;
}

export const sensorsOf = (state: TasmotaState): SensorReading[] => [...state.sensors.values()];

/** A light once it reports one; otherwise what the resident said it is. */
export const kindOf = (state: TasmotaState, stored: DirectKind): DeviceKind =>
  state.dimmer !== null || state.ct !== null || state.hsb ? 'light' : stored;

// ---- Commands ------------------------------------------------------------------------------

export interface TasmotaCommand {
  /** Sent on cmnd/<topic>/<command>. */
  command: string;
  payload: string;
  /** The RESULT key that answers it. */
  expect: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('bad_request', `${what} must be a number.`);
  }
  return value;
}

const POWER_ACTIONS: Record<string, string> = { on: 'ON', off: 'OFF', toggle: 'TOGGLE' };

/** The one Tasmota command a request maps to, or a 4xx ApiError. Mirrors resolveCommand for the hub. */
export function tasmotaCommand(state: TasmotaState, request: CommandRequest): TasmotaCommand {
  const capability = capabilitiesOf(state).find(
    (entry) => entry.type === request.capability && (request.entityId === undefined || entry.entityId === request.entityId),
  );
  if (!capability) {
    throw new ApiError('not_available', 'This device cannot do that.');
  }
  switch (capability.type) {
    case 'power': {
      const payload = Object.hasOwn(POWER_ACTIONS, request.action) ? POWER_ACTIONS[request.action] : undefined;
      if (!payload) break;
      return { command: capability.entityId, payload, expect: capability.entityId };
    }
    case 'brightness':
      if (request.action !== 'set') break;
      return { command: 'Dimmer', payload: String(Math.round(clamp(number(request.value, 'Brightness'), 0, 100))), expect: 'Dimmer' };
    case 'color_temp': {
      if (request.action !== 'set') break;
      const kelvin = clamp(number(request.value, 'Colour temperature'), KELVIN_MIN, KELVIN_MAX);
      return { command: 'CT', payload: String(clamp(Math.round(1_000_000 / kelvin), MIRED_MIN, MIRED_MAX)), expect: 'CT' };
    }
    case 'color': {
      if (request.action !== 'set') break;
      const hs = request.value as { h?: unknown; s?: unknown } | null;
      if (!hs || typeof hs !== 'object') {
        throw new ApiError('bad_request', 'Colour must be { h, s }.');
      }
      const h = Math.round(clamp(number(hs.h, 'Hue'), 0, 360));
      const s = Math.round(clamp(number(hs.s, 'Saturation'), 0, 100));
      // Keeps the brightness the light has now.
      const b = state.hsb?.b ?? state.dimmer ?? 100;
      return { command: 'HSBColor', payload: `${h},${s},${b}`, expect: 'HSBColor' };
    }
    default:
  }
  throw new ApiError('bad_request', `Unknown action for ${request.capability}.`);
}
