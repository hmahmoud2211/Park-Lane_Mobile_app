import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { bearerOf, findUserByEmail, lookupToken, type User } from './auth.ts';
import { alexaDevices, setPower, type ApiSmartDevice } from './devices.ts';
import { parseUtterance, sameWord, words } from './utterance.ts';

export { normalize } from './utterance.ts';

/**
 * What the Alexa skill calls: POST /api/voice/command
 *   { action: 'on' | 'off' | 'status', device?, room? }   from TurnOn/TurnOff/DeviceStatus
 *   { action: 'auto', utterance }                         from VoiceCommandIntent (free speech)
 *
 * The skill authenticates with the EMS access token Alexa holds after
 * account linking (never a shared token). The answer is always a structured
 * `outcome` the skill turns into speech in the customer's language; the
 * backend never claims success the device did not confirm.
 */

export type VoiceAction = 'on' | 'off' | 'status';

interface Spoken {
  name: string;
  room: string | null;
  simulated: boolean;
}

type Failure = 'offline' | 'unreachable' | 'timeout';

export type VoiceOutcome =
  | { outcome: 'done'; action: 'on' | 'off'; device: Spoken & { power: 'on' | 'off' } }
  | { outcome: 'status'; device: Spoken & { power: string; online: boolean } }
  | { outcome: 'ambiguous'; candidates: Spoken[] }
  | { outcome: 'need_device'; candidates: Spoken[] }
  | { outcome: 'need_action'; device: Spoken | null }
  | { outcome: 'not_found'; heard: string }
  | { outcome: 'no_devices' }
  | { outcome: Failure; device: Spoken }
  /** Several devices at once («شغل النور والمكيف»، «طفي كل الأنوار»). */
  | {
      outcome: 'batch';
      action: 'on' | 'off';
      done: Spoken[];
      failed: (Spoken & { reason: Failure })[];
      /** Names heard that matched nothing, or more than one device. */
      unresolved: string[];
    }
  | { outcome: 'batch_status'; devices: (Spoken & { power: string; online: boolean })[]; unresolved: string[] };

// ---- Matching spoken names -------------------------------------------------------------

/** Every word of `needles` is somewhere in `haystack`, allowing small recognition slips. */
const covers = (haystack: readonly string[], needles: readonly string[]) =>
  needles.length > 0 && needles.every((word) => haystack.some((candidate) => sameWord(candidate, word)));

function score(device: ApiSmartDevice, query: readonly string[]): number {
  const name = words(device.name);
  const all = [...name, ...words(device.room)];
  if (query.join(' ') === name.join(' ')) {
    return 4;
  }
  if (covers(query, name) && covers(all, query)) {
    return 3;
  }
  if (covers(all, query)) {
    return 2;
  }
  const shared = query.filter((word) => all.some((candidate) => sameWord(candidate, word))).length;
  return shared > 0 && shared / query.length >= 0.5 ? 1 : 0;
}

const spoken = (device: ApiSmartDevice): Spoken => ({ name: device.name, room: device.room, simulated: device.simulated });

type Resolution =
  | { device: ApiSmartDevice }
  | Extract<VoiceOutcome, { outcome: 'ambiguous' | 'need_device' | 'not_found' | 'no_devices' }>;

export function resolveDevice(devices: readonly ApiSmartDevice[], deviceSlot?: string, roomSlot?: string): Resolution {
  if (devices.length === 0) {
    return { outcome: 'no_devices' };
  }
  let pool = [...devices];
  const room = words(roomSlot);
  if (room.length > 0) {
    pool = pool.filter((device) => covers(words(device.room), room));
    if (pool.length === 0) {
      return { outcome: 'not_found', heard: roomSlot ?? '' };
    }
  }

  const query = words(deviceSlot);
  if (query.length === 0) {
    if (room.length > 0) {
      return pool.length === 1 ? { device: pool[0] } : { outcome: 'ambiguous', candidates: pool.map(spoken) };
    }
    const fallback = devices.find((device) => device.isDefault) ?? (devices.length === 1 ? devices[0] : undefined);
    return fallback ? { device: fallback } : { outcome: 'need_device', candidates: devices.map(spoken) };
  }

  const scored = pool.map((device) => ({ device, score: score(device, query) })).filter((entry) => entry.score > 0);
  if (scored.length === 0) {
    return { outcome: 'not_found', heard: deviceSlot ?? '' };
  }
  const best = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === best);
  return top.length === 1 ? { device: top[0].device } : { outcome: 'ambiguous', candidates: top.map((entry) => spoken(entry.device)) };
}

/** Every device the words describe («كل الأنوار» → every light); all devices when there are no words. */
function devicesMatchingAll(devices: readonly ApiSmartDevice[], phrase: string | undefined): ApiSmartDevice[] {
  const query = words(phrase);
  return query.length === 0 ? [...devices] : devices.filter((device) => score(device, query) >= 2);
}

// ---- The endpoint ------------------------------------------------------------------------

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The EMS user behind Alexa's request: its account-linking token, or the development token. */
export function voiceUser(req: IncomingMessage): User {
  const token = bearerOf(req);
  const linked = lookupToken(token, ['alexa_access']);
  if (linked) {
    return linked.user;
  }
  const { devVoiceToken, devVoiceUserEmail } = config.alexa;
  if (devVoiceToken && devVoiceUserEmail && token && sameSecret(token, devVoiceToken)) {
    const user = findUserByEmail(devVoiceUserEmail.toLowerCase());
    if (user) {
      return user;
    }
  }
  throw new ApiError('unauthorized', 'Account linking is required.');
}

function optionalText(value: unknown, max = 100): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

const FAILURES: Record<string, Failure> = {
  device_offline: 'offline',
  command_timeout: 'timeout',
  device_unreachable: 'unreachable',
};

/** Switches one device; a device that did not confirm is a reported failure, never a success. */
async function switchOne(user: User, device: ApiSmartDevice, action: 'on' | 'off'): Promise<VoiceOutcome> {
  try {
    const after = await setPower(user.id, device.id, action, 'alexa', config.ems.voiceCommandTimeoutMs);
    return { outcome: 'done', action, device: { ...spoken(after), power: after.power as 'on' | 'off' } };
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'internal';
    log.warn('Voice command not confirmed', { id: device.id, code });
    const failure = FAILURES[code];
    if (failure) {
      return { outcome: failure, device: spoken(device) };
    }
    throw error;
  }
}

const statusOf = (device: ApiSmartDevice) => ({ ...spoken(device), power: device.power, online: device.online });

async function many(user: User, action: VoiceAction, devices: ApiSmartDevice[], unresolved: string[]): Promise<VoiceOutcome> {
  if (action === 'status') {
    return { outcome: 'batch_status', devices: devices.map(statusOf), unresolved };
  }
  // Together, so a slow device does not use up Alexa's time for the others.
  const results = await Promise.all(devices.map((device) => switchOne(user, device, action)));
  const done: Spoken[] = [];
  const failed: (Spoken & { reason: Failure })[] = [];
  for (const result of results) {
    if (result.outcome === 'done') {
      done.push(result.device);
    } else if (result.outcome === 'offline' || result.outcome === 'unreachable' || result.outcome === 'timeout') {
      failed.push({ ...result.device, reason: result.outcome });
    }
  }
  return { outcome: 'batch', action, done, failed, unresolved };
}

export async function voiceCommand(user: User, body: Record<string, unknown>): Promise<VoiceOutcome> {
  const requested = body.action;
  if (requested !== 'on' && requested !== 'off' && requested !== 'status' && requested !== 'auto') {
    throw new ApiError('bad_request', 'action must be "on", "off", "status" or "auto".');
  }
  const devices = alexaDevices(user.id);
  const utterance = optionalText(body.utterance, 300);

  // Slots from TurnOn/TurnOff/DeviceStatus: the intent already says what to do.
  if (!utterance) {
    if (requested === 'auto') {
      throw new ApiError('bad_request', 'action "auto" needs an utterance.');
    }
    // A slot may still name several devices or all of them («النور والمكيف»).
    const slot = optionalText(body.device);
    const parsed = slot ? parseUtterance(slot) : null;
    if (parsed && (parsed.all || parsed.targets.length > 1)) {
      return run(user, requested, devices, parsed.targets, parsed.all);
    }
    return single(user, requested, resolveDevice(devices, slot, optionalText(body.room)));
  }

  // Free speech from VoiceCommandIntent, in any phrasing.
  const parsed = parseUtterance(utterance);
  const action = requested !== 'auto' ? requested : parsed.action;
  if (!action) {
    const resolution = resolveDevice(devices, parsed.targets[0]);
    return { outcome: 'need_action', device: 'device' in resolution ? spoken(resolution.device) : null };
  }
  if (parsed.all || parsed.targets.length > 1) {
    return run(user, action, devices, parsed.targets, parsed.all);
  }
  return single(user, action, resolveDevice(devices, parsed.targets[0], optionalText(body.room)));
}

async function single(user: User, action: VoiceAction, resolution: Resolution): Promise<VoiceOutcome> {
  if (!('device' in resolution)) {
    return resolution;
  }
  return action === 'status' ? { outcome: 'status', device: statusOf(resolution.device) } : switchOne(user, resolution.device, action);
}

async function run(user: User, action: VoiceAction, devices: ApiSmartDevice[], targets: string[], all: boolean): Promise<VoiceOutcome> {
  if (devices.length === 0) {
    return { outcome: 'no_devices' };
  }
  const chosen = new Map<string, ApiSmartDevice>();
  const unresolved: string[] = [];
  if (all) {
    const phrases = targets.length > 0 ? targets : [undefined];
    for (const phrase of phrases) {
      for (const device of devicesMatchingAll(devices, phrase)) {
        chosen.set(device.id, device);
      }
    }
  } else {
    for (const target of targets) {
      const resolution = resolveDevice(devices, target);
      if ('device' in resolution) {
        chosen.set(resolution.device.id, resolution.device);
      } else {
        unresolved.push(target);
      }
    }
  }
  if (chosen.size === 0) {
    return { outcome: 'not_found', heard: targets.join('، ') };
  }
  // One device after all: answer as for one.
  if (chosen.size === 1 && unresolved.length === 0) {
    return single(user, action, { device: [...chosen.values()][0] });
  }
  return many(user, action, [...chosen.values()], unresolved);
}
