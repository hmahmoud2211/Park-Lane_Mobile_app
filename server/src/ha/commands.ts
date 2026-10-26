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
 */

export interface ServiceCall {
  domain: string;
  service: string;
  entityId: string;
  data: Record<string, unknown>;
}

type Build = (value: unknown, capability: Capability) => { service: string; data?: Record<string, unknown> };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('bad_request', `${what} must be a number.`);
  }
  return value;
}

function oneOf(value: unknown, options: readonly string[], what: string): string {
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new ApiError('bad_request', `${what} must be one of: ${options.join(', ') || '(none available)'}.`);
  }
  return value;
}

const as = <T extends CapabilityType>(capability: Capability, type: T) => capability as Extract<Capability, { type: T }>;

const RULES: Record<CapabilityType, Record<string, Build>> = {
  power: {
    on: () => ({ service: 'turn_on' }),
    off: () => ({ service: 'turn_off' }),
    toggle: () => ({ service: 'toggle' }),
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
      if (target === null) {
        throw new ApiError('not_available', 'This device has no target temperature.');
      }
      return { service: 'set_temperature', data: { temperature: clamp(number(value, 'Temperature'), min, max) } };
    },
    set_mode: (value, capability) => ({
      service: 'set_hvac_mode',
      data: { hvac_mode: oneOf(value, as(capability, 'climate').modes, 'Mode') },
    }),
    set_fan_mode: (value, capability) => ({
      service: 'set_fan_mode',
      data: { fan_mode: oneOf(value, as(capability, 'climate').fanModes, 'Fan mode') },
    }),
  },
  cover: {
    open: () => ({ service: 'open_cover' }),
    close: () => ({ service: 'close_cover' }),
    stop: (_value, capability) => {
      if (!as(capability, 'cover').canStop) {
        throw new ApiError('not_available', 'This cover cannot stop part way.');
      }
      return { service: 'stop_cover' };
    },
    set_position: (value, capability) => {
      if (!as(capability, 'cover').canPosition) {
        throw new ApiError('not_available', 'This cover cannot be set to a position.');
      }
      return { service: 'set_cover_position', data: { position: Math.round(clamp(number(value, 'Position'), 0, 100)) } };
    },
  },
  lock: {
    lock: () => ({ service: 'lock' }),
    unlock: () => ({ service: 'unlock' }),
  },
  fan: {
    set_percentage: (value) => ({ service: 'set_percentage', data: { percentage: Math.round(clamp(number(value, 'Speed'), 0, 100)) } }),
    set_preset: (value, capability) => ({
      service: 'set_preset_mode',
      data: { preset_mode: oneOf(value, as(capability, 'fan').presetModes, 'Preset') },
    }),
  },
  media: {
    play: () => ({ service: 'media_play' }),
    pause: () => ({ service: 'media_pause' }),
    next: () => ({ service: 'media_next_track' }),
    previous: () => ({ service: 'media_previous_track' }),
    set_volume: (value, capability) => {
      if (as(capability, 'media').volume === null) {
        throw new ApiError('not_available', 'This player has no volume control.');
      }
      return { service: 'volume_set', data: { volume_level: clamp(number(value, 'Volume'), 0, 1) } };
    },
    mute: (value, capability) => {
      if (typeof value !== 'boolean') {
        throw new ApiError('bad_request', 'Mute takes true or false.');
      }
      if (as(capability, 'media').muted === null) {
        throw new ApiError('not_available', 'This player cannot be muted.');
      }
      return { service: 'volume_mute', data: { is_volume_muted: value } };
    },
    select_source: (value, capability) => ({
      service: 'select_source',
      data: { source: oneOf(value, as(capability, 'media').sources, 'Source') },
    }),
  },
  press: {
    press: () => ({ service: 'press' }),
  },
};

/** Actions that are written to the audit log. */
export const AUDITED = new Set(['lock.unlock']);

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
  const capability = device.capabilities.find(
    (entry) => entry.type === request.capability && (request.entityId === undefined || entry.entityId === request.entityId),
  );
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
