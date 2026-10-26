import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { sonoffLanAdapter } from './adapters/sonoffLan.ts';
import type { AdapterDevice, DeviceAdapter, DeviceType, HardwareReport, Power } from './adapters/types.ts';
import { virtualAdapter } from './adapters/virtual.ts';
import { db, transaction } from './db.ts';
import { publish } from './events.ts';
import { seal, unseal } from './secrets.ts';

/**
 * The device registry and the one controller every command goes through,
 * whether it comes from the app or from Alexa:
 *
 *   request -> ownership check -> pending_power set (pushed to clients)
 *           -> adapter.setPower (waits for the device to confirm)
 *           -> confirmed power stored, or the error and offline state
 *           -> pushed to every open app session of the owner
 *
 * `power` only ever holds what a device confirmed; `pending_power` holds
 * what was asked for while the command is in flight.
 */

export type { DeviceType, Power } from './adapters/types.ts';

/** A device as the app and the voice API see it (SmartDevice in the app). */
export interface ApiSmartDevice {
  id: string;
  name: string;
  room: string | null;
  type: DeviceType;
  protocol: string;
  /** No hardware behind it: a virtual switch. */
  simulated: boolean;
  online: boolean;
  power: Power;
  pendingPower: 'on' | 'off' | null;
  alexaEnabled: boolean;
  isDefault: boolean;
  lastSeen: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeviceRow {
  id: string;
  owner_id: string;
  name: string;
  room: string | null;
  type: DeviceType;
  protocol: string;
  external_id: string | null;
  online: number;
  power: Power;
  pending_power: 'on' | 'off' | null;
  alexa_enabled: number;
  is_default: number;
  last_seen: string | null;
  last_error: string | null;
  adapter_config: string | null;
  created_at: string;
  updated_at: string;
}

const adapters = new Map<string, DeviceAdapter>([
  [virtualAdapter.protocol, virtualAdapter],
  [sonoffLanAdapter.protocol, sonoffLanAdapter],
]);

/** Tests register a stand-in for real hardware here. */
export function registerAdapter(adapter: DeviceAdapter): void {
  adapters.set(adapter.protocol, adapter);
}

function adapterFor(protocol: string): DeviceAdapter {
  const adapter = adapters.get(protocol);
  if (!adapter) {
    throw new ApiError('bad_request', `Unsupported protocol "${protocol}".`);
  }
  return adapter;
}

function toApi(row: DeviceRow): ApiSmartDevice {
  return {
    id: row.id,
    name: row.name,
    room: row.room,
    type: row.type,
    protocol: row.protocol,
    simulated: adapters.get(row.protocol)?.simulated ?? false,
    online: row.online === 1,
    power: row.power,
    pendingPower: row.pending_power,
    alexaEnabled: row.alexa_enabled === 1,
    isDefault: row.is_default === 1,
    lastSeen: row.last_seen,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function adapterDevice(row: DeviceRow): AdapterDevice {
  return {
    id: row.id,
    online: row.online === 1,
    config: row.adapter_config ? (JSON.parse(unseal(row.adapter_config)) as Record<string, unknown>) : null,
  };
}

const ID = /^[0-9a-f-]{36}$/i;

function ownedRow(userId: string, id: string): DeviceRow {
  if (!ID.test(id)) {
    throw new ApiError('not_found', 'No such device.');
  }
  const row = db().prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
  // Someone else's device answers exactly like a missing one.
  if (!row || row.owner_id !== userId) {
    throw new ApiError('not_found', 'No such device.');
  }
  return row;
}

function reload(id: string): DeviceRow {
  return db().prepare('SELECT * FROM devices WHERE id = ?').get(id) as unknown as DeviceRow;
}

function emit(row: DeviceRow): ApiSmartDevice {
  const device = toApi(row);
  publish(row.owner_id, { type: 'device', device });
  return device;
}

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ApiError('bad_request', `${field} is required.`);
    }
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError('bad_request', `${field} must be text of at most ${max} characters.`);
  }
  return value.trim();
}

const TYPES: readonly DeviceType[] = ['switch', 'plug', 'light', 'virtual'];

export function listDevices(userId: string): ApiSmartDevice[] {
  const rows = db()
    .prepare('SELECT * FROM devices WHERE owner_id = ? ORDER BY room IS NULL, room, name')
    .all(userId) as unknown as DeviceRow[];
  return rows.map(toApi);
}

export function getDevice(userId: string, id: string): ApiSmartDevice {
  return toApi(ownedRow(userId, id));
}

export async function createDevice(userId: string, body: Record<string, unknown>): Promise<ApiSmartDevice> {
  const name = text(body.name, 'name', 64, true) as string;
  const room = text(body.room, 'room', 64, false);
  const protocol = typeof body.protocol === 'string' ? body.protocol : 'virtual';
  const adapter = adapterFor(protocol);
  const type = (typeof body.type === 'string' ? body.type : adapter.types[0]) as DeviceType;
  if (!TYPES.includes(type) || !adapter.types.includes(type)) {
    throw new ApiError('bad_request', `A ${protocol} device cannot be a "${String(body.type)}".`);
  }
  const input = (body[protocol === 'sonoff-lan' ? 'sonoff' : 'settings'] ?? {}) as Record<string, unknown>;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError('bad_request', 'Device settings must be an object.');
  }

  const prepared = await adapter.prepare(input);
  const now = new Date().toISOString();
  const sealed = prepared.config ? seal(JSON.stringify(prepared.config)) : null;

  const id = transaction(() => {
    if (prepared.externalId) {
      const existing = db()
        .prepare('SELECT id, owner_id FROM devices WHERE protocol = ? AND external_id = ?')
        .get(protocol, prepared.externalId) as { id: string; owner_id: string } | undefined;
      if (existing && existing.owner_id !== userId) {
        throw new ApiError('conflict', 'This device is already registered to another EMS account.');
      }
      if (existing) {
        // Pairing the same plug again refreshes it instead of adding a copy.
        db()
          .prepare(
            `UPDATE devices SET name = ?, room = ?, type = ?, adapter_config = ?, online = ?, power = ?,
               last_seen = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(name, room, type, sealed, prepared.online ? 1 : 0, prepared.power, now, now, existing.id);
        return existing.id;
      }
    }
    const newId = randomUUID();
    const first = !(db().prepare('SELECT 1 FROM devices WHERE owner_id = ? LIMIT 1').get(userId));
    db()
      .prepare(
        `INSERT INTO devices (id, owner_id, name, room, type, protocol, external_id, online, power,
           alexa_enabled, is_default, last_seen, adapter_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        userId,
        name,
        room,
        type,
        protocol,
        prepared.externalId,
        prepared.online ? 1 : 0,
        prepared.power,
        // The first device answers "turn on" with no name.
        first ? 1 : 0,
        prepared.online ? now : null,
        sealed,
        now,
        now,
      );
    return newId;
  });
  log.info('Device registered', { id, protocol, type });
  return emit(reload(id));
}

export function updateDevice(userId: string, id: string, body: Record<string, unknown>): ApiSmartDevice {
  const row = ownedRow(userId, id);
  const changes: string[] = [];
  const values: (string | number | null)[] = [];
  if (body.name !== undefined) {
    changes.push('name = ?');
    values.push(text(body.name, 'name', 64, true));
  }
  if (body.room !== undefined) {
    changes.push('room = ?');
    values.push(text(body.room, 'room', 64, false));
  }
  if (body.alexaEnabled !== undefined) {
    if (typeof body.alexaEnabled !== 'boolean') {
      throw new ApiError('bad_request', 'alexaEnabled must be true or false.');
    }
    changes.push('alexa_enabled = ?');
    values.push(body.alexaEnabled ? 1 : 0);
  }
  if (body.online !== undefined) {
    // Only a virtual switch can be told it is offline; real devices report it.
    if (typeof body.online !== 'boolean' || !adapterFor(row.protocol).simulated) {
      throw new ApiError('bad_request', 'online can only be set on a virtual switch.');
    }
    changes.push('online = ?');
    values.push(body.online ? 1 : 0);
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new ApiError('bad_request', 'isDefault must be true or false.');
  }
  if (changes.length === 0 && body.isDefault === undefined) {
    throw new ApiError('bad_request', 'Nothing to change.');
  }

  const touched = transaction(() => {
    const now = new Date().toISOString();
    if (changes.length > 0) {
      db()
        .prepare(`UPDATE devices SET ${changes.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...values, now, id);
    }
    const others: string[] = [];
    if (body.isDefault === true) {
      for (const other of db()
        .prepare('SELECT id FROM devices WHERE owner_id = ? AND is_default = 1 AND id != ?')
        .all(userId, id) as { id: string }[]) {
        others.push(other.id);
      }
      db().prepare('UPDATE devices SET is_default = 0, updated_at = ? WHERE owner_id = ? AND id != ? AND is_default = 1').run(now, userId, id);
    }
    if (body.isDefault !== undefined) {
      db().prepare('UPDATE devices SET is_default = ?, updated_at = ? WHERE id = ?').run(body.isDefault ? 1 : 0, now, id);
    }
    return others;
  });
  for (const other of touched) {
    emit(reload(other));
  }
  return emit(reload(id));
}

export function deleteDevice(userId: string, id: string): void {
  const row = ownedRow(userId, id);
  db().prepare('DELETE FROM devices WHERE id = ?').run(row.id);
  publish(userId, { type: 'device_removed', id: row.id });
}

// ---- Commands ------------------------------------------------------------------------

/** One command per device at a time; a second waits for the first. */
const inFlight = new Map<string, Promise<unknown>>();

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('command_timeout', 'The device did not confirm in time.')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const OFFLINE_CODES = new Set(['device_offline', 'device_unreachable', 'command_timeout']);

export type CommandSource = 'app' | 'alexa';

/** Switches a device and resolves with its confirmed state; throws if the device did not confirm. */
export async function setPower(
  userId: string,
  id: string,
  power: unknown,
  source: CommandSource,
  timeoutMs: number = config.ems.commandTimeoutMs,
): Promise<ApiSmartDevice> {
  if (power !== 'on' && power !== 'off') {
    throw new ApiError('bad_request', 'power must be "on" or "off".');
  }
  ownedRow(userId, id);
  const previous = inFlight.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => command(userId, id, power, source, timeoutMs));
  inFlight.set(id, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(id) === run) {
      inFlight.delete(id);
    }
  }
}

async function command(
  userId: string,
  id: string,
  power: 'on' | 'off',
  source: CommandSource,
  timeoutMs: number,
): Promise<ApiSmartDevice> {
  const row = ownedRow(userId, id);
  const adapter = adapterFor(row.protocol);
  db().prepare('UPDATE devices SET pending_power = ? WHERE id = ?').run(power, id);
  emit(reload(id));

  try {
    await withTimeout(adapter.setPower(adapterDevice(row), power), timeoutMs);
  } catch (error) {
    const known = error instanceof ApiError ? error : new ApiError('device_unreachable', 'The device could not be switched.');
    const now = new Date().toISOString();
    db()
      .prepare(
        `UPDATE devices SET pending_power = NULL, last_error = ?, online = CASE WHEN ? THEN 0 ELSE online END,
           updated_at = ? WHERE id = ?`,
      )
      .run(known.message, OFFLINE_CODES.has(known.code) ? 1 : 0, now, id);
    emit(reload(id));
    log.warn('Device command failed', { id, source, power, code: known.code });
    throw known;
  }

  const now = new Date().toISOString();
  db()
    .prepare(
      `UPDATE devices SET power = ?, pending_power = NULL, online = 1, last_error = NULL, last_seen = ?,
         updated_at = ? WHERE id = ?`,
    )
    .run(power, now, now, id);
  log.info('Device switched', { id, source, power });
  return emit(reload(id));
}

// ---- Reports from hardware -----------------------------------------------------------

function applyReport(report: HardwareReport): void {
  const row = db()
    .prepare('SELECT * FROM devices WHERE protocol = ? AND external_id = ?')
    .get(report.protocol, report.externalId) as DeviceRow | undefined;
  if (!row) {
    return;
  }
  const online = report.online === undefined ? row.online === 1 : report.online;
  // A command in flight decides the state; an announcement racing it does not.
  const power = report.power && !row.pending_power ? report.power : row.power;
  const sealed = report.config ? seal(JSON.stringify(report.config)) : row.adapter_config;
  if (online === (row.online === 1) && power === row.power && sealed === row.adapter_config) {
    return;
  }
  const now = new Date().toISOString();
  db()
    .prepare('UPDATE devices SET online = ?, power = ?, adapter_config = ?, last_seen = CASE WHEN ? THEN ? ELSE last_seen END, updated_at = ? WHERE id = ?')
    .run(online ? 1 : 0, power, sealed, online ? 1 : 0, now, now, row.id);
  emit(reload(row.id));
}

export function startAdapters(): void {
  for (const adapter of adapters.values()) {
    adapter.start?.(applyReport, () =>
      (db().prepare('SELECT * FROM devices WHERE protocol = ?').all(adapter.protocol) as unknown as DeviceRow[]).map(
        adapterDevice,
      ),
    );
  }
}

/** Devices Alexa may use, with names for matching (voice.ts). */
export function alexaDevices(userId: string): ApiSmartDevice[] {
  return listDevices(userId).filter((device) => device.alexaEnabled);
}
