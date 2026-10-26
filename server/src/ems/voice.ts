import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { bearerOf, findUserByEmail, lookupToken, type User } from './auth.ts';
import { alexaDevices, setPower, type ApiSmartDevice } from './devices.ts';

/**
 * What the Alexa skill calls: POST /api/voice/command
 *   { action: 'on' | 'off' | 'status', device?: string, room?: string }
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

export type VoiceOutcome =
  | { outcome: 'done'; action: 'on' | 'off'; device: Spoken & { power: 'on' | 'off' } }
  | { outcome: 'status'; device: Spoken & { power: string; online: boolean } }
  | { outcome: 'ambiguous'; candidates: Spoken[] }
  | { outcome: 'need_device'; candidates: Spoken[] }
  | { outcome: 'not_found'; heard: string }
  | { outcome: 'no_devices' }
  | { outcome: 'offline' | 'unreachable' | 'timeout'; device: Spoken };

// ---- Matching spoken names -------------------------------------------------------------

/** Folds the spellings speech recognition varies between, in Arabic and English. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '') // harakat, dagger alif, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(['the', 'my', 'in', 'on', 'of', 'a', 'an', 'في', 'على', 'من']);

function tokens(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return normalize(value)
    .split(' ')
    .filter((word) => word && !STOP_WORDS.has(word))
    // "النوم" and "نوم" are the same word to a listener.
    .map((word) => (word.length > 3 && word.startsWith('ال') ? word.slice(2) : word));
}

const covers = (haystack: readonly string[], needles: readonly string[]) =>
  needles.length > 0 && needles.every((word) => haystack.includes(word));

function score(device: ApiSmartDevice, query: readonly string[]): number {
  const name = tokens(device.name);
  const all = [...name, ...tokens(device.room)];
  if (query.join(' ') === name.join(' ')) {
    return 4;
  }
  if (covers(query, name) && covers(all, query)) {
    return 3;
  }
  if (covers(all, query)) {
    return 2;
  }
  const shared = query.filter((word) => all.includes(word)).length;
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
  const room = tokens(roomSlot ?? null);
  if (room.length > 0) {
    pool = pool.filter((device) => covers(tokens(device.room), room));
    if (pool.length === 0) {
      return { outcome: 'not_found', heard: roomSlot ?? '' };
    }
  }

  const query = tokens(deviceSlot ?? null);
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

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;
}

export async function voiceCommand(user: User, body: Record<string, unknown>): Promise<VoiceOutcome> {
  const action = body.action;
  if (action !== 'on' && action !== 'off' && action !== 'status') {
    throw new ApiError('bad_request', 'action must be "on", "off" or "status".');
  }
  const resolution = resolveDevice(alexaDevices(user.id), optionalText(body.device), optionalText(body.room));
  if (!('device' in resolution)) {
    return resolution;
  }
  const { device } = resolution;

  if (action === 'status') {
    return { outcome: 'status', device: { ...spoken(device), power: device.power, online: device.online } };
  }
  try {
    const after = await setPower(user.id, device.id, action, 'alexa', config.ems.voiceCommandTimeoutMs);
    return { outcome: 'done', action, device: { ...spoken(after), power: after.power as 'on' | 'off' } };
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'internal';
    log.warn('Voice command not confirmed', { id: device.id, code });
    if (code === 'device_offline') {
      return { outcome: 'offline', device: spoken(device) };
    }
    if (code === 'command_timeout') {
      return { outcome: 'timeout', device: spoken(device) };
    }
    if (code === 'device_unreachable') {
      return { outcome: 'unreachable', device: spoken(device) };
    }
    throw error;
  }
}
