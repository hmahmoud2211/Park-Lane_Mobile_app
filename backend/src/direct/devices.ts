import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { config } from '../config.ts';
import { db } from '../ems/db.ts';
import { publish } from '../ems/events.ts';
import { sha256 } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import type { CommandSource } from '../ha/commands.ts';
import type { CommandRequest, Device } from '../ha/types.ts';
import { membersOfUnit, unitForUser } from '../ha/units.ts';
import { log } from '../log.ts';
import { startDeviceEndpoint, stopDeviceEndpoint, type DeviceSession } from './mqttServer.ts';
import {
  applyMessage,
  capabilitiesOf,
  DIRECT_KINDS,
  emptyState,
  kindOf,
  sensorsOf,
  tasmotaCommand,
  type DirectKind,
  type TasmotaState,
} from './tasmota.ts';

/**
 * Direct mode: devices that connect to this backend themselves, with no hub
 * in the unit or on the server. Today that is Tasmota firmware over MQTT
 * (tasmota.ts). The plug opens the connection, so it works from any network.
 *
 *   app ─ POST /api/direct/pairings ─▶ backend      a login for one device, shown once
 *   app ─ Wi-Fi + login, on the plug's hotspot ─▶ plug
 *   plug ─ MQTT over TLS (mqttServer.ts) ─▶ backend  its first login claims it for the unit
 *   app ─ POST …/commands ─▶ backend ─ cmnd/<topic>/… ─▶ plug ─ stat/<topic>/RESULT ─▶ backend ─▶ app
 *
 * A device belongs to the unit it was paired from; only that unit's
 * residents see it. It is shown in the facade's device shape (ha/types.ts),
 * so the app's cards and controls work unchanged, in a list of its own
 * (/api/direct/devices): the app's Direct mode.
 */

interface DirectRow {
  id: string;
  unit_id: string;
  username: string;
  password_hash: string;
  name: string;
  kind: DirectKind;
  model: string | null;
  firmware: string | null;
  mac: string | null;
  created_by: string | null;
  created_at: string;
  claimed_at: string | null;
  expires_at: number | null;
}

/** A device's connection and what it last reported; rebuilt from the device itself after a restart. */
interface Live {
  session: DeviceSession | null;
  state: TasmotaState;
  pending: Device['pending'];
  lastError: string | null;
  lastChanged: number | null;
  /** Asked for its state on this connection. */
  queried: boolean;
  waiter: Waiter | null;
}

interface Waiter {
  expect: string;
  resolve: () => void;
  reject: (error: ApiError) => void;
}

export interface DirectPairing {
  deviceId: string;
  expiresAt: number;
  /** What the app writes to the plug. The password is never stored or shown again. */
  mqtt: { host: string; port: number; tls: boolean; username: string; password: string; topic: string };
}

const ID = /^[0-9a-f-]{36}$/i;
const USERNAME = /^pl[0-9a-f]{10}$/;
/** Unfinished pairings a unit may have at once. */
const MAX_WAITING = 5;
/** Failed logins from one address before it is refused for a minute. A building shares one address. */
const MAX_FAILURES = 20;

const lives = new Map<string, Live>();
/** MQTT username → device id, for connected devices. */
const ids = new Map<string, string>();
const failures = new Map<string, { count: number; resetAt: number }>();
let running: { tls: boolean } | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

const now = () => Date.now();
const nowIso = () => new Date().toISOString();

function liveOf(id: string): Live {
  let live = lives.get(id);
  if (!live) {
    live = { session: null, state: emptyState(), pending: null, lastError: null, lastChanged: null, queried: false, waiter: null };
    lives.set(id, live);
  }
  return live;
}

const rowById = (id: string) => db().prepare('SELECT * FROM direct_devices WHERE id = ?').get(id) as DirectRow | undefined;
const rowByUsername = (username: string) =>
  db().prepare('SELECT * FROM direct_devices WHERE username = ?').get(username) as DirectRow | undefined;

function toDevice(row: DirectRow): Device {
  const live = lives.get(row.id);
  const state = live?.state ?? emptyState();
  return {
    id: row.id,
    name: row.name,
    // Rooms are Home Assistant's; direct devices have none yet.
    roomId: null,
    room: null,
    kind: kindOf(state, row.kind),
    manufacturer: null,
    model: state.model ?? row.model,
    integration: 'tasmota',
    accountId: null,
    online: Boolean(live?.session),
    capabilities: capabilitiesOf(state),
    sensors: sensorsOf(state),
    pending: live?.pending ?? null,
    lastChanged: live?.lastChanged ?? null,
    lastError: live?.lastError ?? null,
  };
}

function emit(row: DirectRow): Device {
  const device = toDevice(row);
  if (row.claimed_at) {
    membersOfUnit(row.unit_id).forEach((userId) => publish(userId, { type: 'direct_device', device }));
  }
  return device;
}

/** Forgets a device's connection, closing it if it is still open. */
function drop(row: DirectRow) {
  const live = lives.get(row.id);
  lives.delete(row.id);
  ids.delete(row.username);
  live?.waiter?.reject(new ApiError('not_found', 'The device was removed.'));
  live?.session?.close();
}

/** Pairings whose plug never connected. */
function sweep() {
  const stale = db()
    .prepare('SELECT * FROM direct_devices WHERE claimed_at IS NULL AND expires_at < ?')
    .all(now()) as unknown as DirectRow[];
  for (const row of stale) {
    drop(row);
    db().prepare('DELETE FROM direct_devices WHERE id = ?').run(row.id);
  }
}

function ownedRow(userId: string, id: string, { claimed = true } = {}): DirectRow {
  const unit = unitForUser(userId);
  const row = ID.test(id) ? rowById(id) : undefined;
  // Another unit's device answers exactly like a missing one.
  if (!row || row.unit_id !== unit.id || (claimed && !row.claimed_at)) {
    throw new ApiError('not_found', 'No such device in your home.');
  }
  return row;
}

function nameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 64) : '';
  if (!name) {
    throw new ApiError('bad_request', 'The device needs a name.');
  }
  return name;
}

// ---- The device connections (mqttServer.ts) ---------------------------------------------------

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const handlers = {
  authenticate(username: string, password: string, address: string): 'ok' | 'refused' | 'limited' {
    const failed = failures.get(address);
    if (failed && failed.resetAt > now() && failed.count >= MAX_FAILURES) {
      return 'limited';
    }
    const row = USERNAME.test(username) ? rowByUsername(username) : undefined;
    const usable = row && (row.claimed_at || (row.expires_at ?? 0) > now());
    if (usable && sameSecret(sha256(password), row.password_hash)) {
      return 'ok';
    }
    const window = failed && failed.resetAt > now() ? failed : { count: 0, resetAt: now() + 60_000 };
    failures.set(address, { count: window.count + 1, resetAt: window.resetAt });
    return 'refused';
  },

  onConnect(session: DeviceSession) {
    const row = rowByUsername(session.username);
    if (!row) {
      session.close();
      return;
    }
    const live = liveOf(row.id);
    const previous = live.session;
    live.session = session;
    live.queried = false;
    ids.set(row.username, row.id);
    // The same device again (it restarted before the old socket timed out): the new one wins.
    if (previous && previous !== session) {
      previous.close();
    }
    if (!row.claimed_at) {
      db().prepare('UPDATE direct_devices SET claimed_at = ?, expires_at = NULL WHERE id = ?').run(nowIso(), row.id);
      log.info('Direct device paired', { id: row.id, unitId: row.unit_id });
    }
    log.info('Direct device connected', { id: row.id, address: session.address });
    emit(rowById(row.id) as DirectRow);
  },

  onSubscribe(session: DeviceSession) {
    const id = ids.get(session.username);
    const live = id ? lives.get(id) : undefined;
    if (!live || live.session !== session || live.queried) {
      return;
    }
    // Names, firmware, MAC and readings; then power and light state.
    live.queried = true;
    session.publish(`cmnd/${session.username}/STATUS`, '0');
    session.publish(`cmnd/${session.username}/STATE`, '');
  },

  onMessage(session: DeviceSession, topic: string, payload: Buffer) {
    const id = ids.get(session.username);
    const live = id ? lives.get(id) : undefined;
    if (!id || !live || live.session !== session) {
      return;
    }
    const effect = applyMessage(live.state, session.username, topic, payload);
    if (effect.result && live.waiter) {
      const { waiter } = live;
      if (Object.hasOwn(effect.result, waiter.expect)) {
        waiter.resolve();
      } else if (effect.result.Command === 'Unknown' || effect.result.Command === 'Error') {
        waiter.reject(new ApiError('not_available', 'The device did not accept that command.'));
      }
    }
    if (effect.identity) {
      const { model, firmware, mac } = live.state;
      db().prepare('UPDATE direct_devices SET model = ?, firmware = ?, mac = ? WHERE id = ?').run(model, firmware, mac, id);
    }
    if (effect.changed) {
      live.lastChanged = Math.floor(now() / 1000);
      const row = rowById(id);
      if (row) emit(row);
    }
  },

  onClose(session: DeviceSession) {
    const id = ids.get(session.username);
    const live = id ? lives.get(id) : undefined;
    if (!id || !live || live.session !== session) {
      return;
    }
    live.session = null;
    live.waiter?.reject(new ApiError('device_offline', 'The device went offline before it answered.'));
    log.info('Direct device disconnected', { id });
    const row = rowById(id);
    if (row) emit(row);
  },
};

// ---- Residents (routes in app.ts) --------------------------------------------------------------

export const isDirectEnabled = () => running !== null && config.direct.publicHost !== '';

/** A login for one new device in the resident's unit, for the app to write to the plug. */
export function createPairing(userId: string, body: Record<string, unknown>): DirectPairing {
  if (!running) {
    throw new ApiError('not_configured', 'Direct devices are not set up on this server (DIRECT_MQTT_PORT).');
  }
  if (!config.direct.publicHost) {
    throw new ApiError('not_configured', 'Direct devices are not set up on this server (DIRECT_MQTT_PUBLIC_HOST).');
  }
  const unit = unitForUser(userId);
  const name = nameOf(body.name);
  const kind = body.kind === undefined ? 'plug' : body.kind;
  if (typeof kind !== 'string' || !DIRECT_KINDS.includes(kind as DirectKind)) {
    throw new ApiError('bad_request', `kind must be one of: ${DIRECT_KINDS.join(', ')}.`);
  }
  sweep();
  const waiting = db()
    .prepare('SELECT COUNT(*) AS count FROM direct_devices WHERE unit_id = ? AND claimed_at IS NULL')
    .get(unit.id) as { count: number };
  if (waiting.count >= MAX_WAITING) {
    throw new ApiError('rate_limited', 'Finish setting up the devices you started first, or wait half an hour.');
  }

  const id = randomUUID();
  // Short and plain: Tasmota's Topic and MqttUser take 32 characters, and these travel in a URL.
  const username = `pl${randomBytes(5).toString('hex')}`;
  const password = randomBytes(18).toString('base64url');
  const expiresAt = now() + config.direct.pairingTtlMs;
  db()
    .prepare(
      `INSERT INTO direct_devices (id, unit_id, username, password_hash, name, kind, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, unit.id, username, sha256(password), name, kind, userId, nowIso(), expiresAt);
  log.info('Direct pairing started', { id, unitId: unit.id });
  return {
    deviceId: id,
    expiresAt,
    mqtt: { host: config.direct.publicHost, port: config.direct.publicPort, tls: running.tls, username, password, topic: username },
  };
}

/** Whether the plug has connected yet; the app asks while the resident waits. */
export function pairingStatus(userId: string, id: string): { status: 'waiting' | 'connected' | 'expired'; device: Device | null } {
  const unit = unitForUser(userId);
  const row = ID.test(id) ? rowById(id) : undefined;
  if (!row || row.unit_id !== unit.id) {
    return { status: 'expired', device: null };
  }
  if (row.claimed_at) {
    return { status: 'connected', device: toDevice(row) };
  }
  return (row.expires_at ?? 0) > now() ? { status: 'waiting', device: null } : { status: 'expired', device: null };
}

export function listDirectDevices(userId: string): Device[] {
  const unit = unitForUser(userId);
  const rows = db()
    .prepare('SELECT * FROM direct_devices WHERE unit_id = ? AND claimed_at IS NOT NULL ORDER BY name')
    .all(unit.id) as unknown as DirectRow[];
  return rows.map(toDevice);
}

export const getDirectDevice = (userId: string, id: string): Device => toDevice(ownedRow(userId, id));

export function updateDirectDevice(userId: string, id: string, changes: { name?: unknown }): Device {
  const row = ownedRow(userId, id);
  if (changes.name === undefined) {
    throw new ApiError('bad_request', 'Nothing to change: send name.');
  }
  db().prepare('UPDATE direct_devices SET name = ? WHERE id = ?').run(nameOf(changes.name), row.id);
  return emit(rowById(row.id) as DirectRow);
}

/** Removes a device, or a pairing in progress. The plug is disconnected and its login stops working. */
export function removeDirectDevice(userId: string, id: string): void {
  const row = ownedRow(userId, id, { claimed: false });
  drop(row);
  db().prepare('DELETE FROM direct_devices WHERE id = ?').run(row.id);
  if (row.claimed_at) {
    membersOfUnit(row.unit_id).forEach((member) => publish(member, { type: 'direct_device_removed', id: row.id }));
  }
  log.info('Direct device removed', { id: row.id });
}

/** Disconnects a unit's devices before the unit is deleted (its rows go with it). */
export function disconnectUnit(unitId: string): void {
  const rows = db().prepare('SELECT * FROM direct_devices WHERE unit_id = ?').all(unitId) as unknown as DirectRow[];
  rows.forEach(drop);
}

/**
 * Runs one allowlisted command and resolves with the device once it has
 * answered. Shown as pending to every open app until then; a device that
 * does not answer in time is reported, never shown as switched.
 */
export async function directCommand(userId: string, id: string, request: CommandRequest, source: CommandSource = 'app'): Promise<Device> {
  const row = ownedRow(userId, id);
  const live = liveOf(row.id);
  const session = live.session;
  if (!session) {
    throw new ApiError('device_offline', 'This device is offline. Check that it has power and Wi-Fi.');
  }
  if (live.pending) {
    throw new ApiError('conflict', 'This device is still busy with the last command.');
  }
  const command = tasmotaCommand(live.state, request);
  live.pending = { entityId: command.expect, capability: request.capability, action: request.action };
  live.lastError = null;
  emit(row);
  if (source === 'assistant') {
    db()
      .prepare('INSERT INTO audit_log (user_id, hub_id, action, target, via, at) VALUES (?, NULL, ?, ?, ?, ?)')
      .run(userId, `tasmota.${command.command}`, row.id, source, nowIso());
  }

  let timer: NodeJS.Timeout | undefined;
  const answered = new Promise<void>((resolve, reject) => {
    live.waiter = { expect: command.expect, resolve, reject };
    timer = setTimeout(
      () => reject(new ApiError('command_timeout', 'The device did not answer. Check that it is still on Wi-Fi.')),
      config.direct.commandTimeoutMs,
    );
  });
  session.publish(`cmnd/${row.username}/${command.command}`, command.payload);
  try {
    await answered;
  } catch (error) {
    live.lastError = (error as Error).message;
    throw error;
  } finally {
    clearTimeout(timer);
    live.waiter = null;
    live.pending = null;
    const current = rowById(row.id);
    if (current) emit(current);
  }
  return toDevice(rowById(row.id) as DirectRow);
}

// ---- Starting and stopping -----------------------------------------------------------------------

/** Opens the device port when DIRECT_MQTT_PORT is set. */
export async function startDirect(): Promise<void> {
  const { port, certFile, keyFile, publicHost } = config.direct;
  if (!port) {
    return;
  }
  let tls: { cert: string; key: string } | null = null;
  if (certFile || keyFile) {
    try {
      tls = { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') };
    } catch (error) {
      log.error('Direct devices are off: DIRECT_MQTT_CERT or DIRECT_MQTT_KEY could not be read', { reason: (error as Error).message });
      return;
    }
  } else {
    log.warn('DEVELOPMENT ONLY: DIRECT_MQTT_CERT and DIRECT_MQTT_KEY are not set, so direct devices connect without encryption.');
  }
  if (!publicHost) {
    log.warn('DIRECT_MQTT_PUBLIC_HOST is not set: direct devices that are already paired connect, new ones cannot be paired.');
  }
  await startDeviceEndpoint({ host: config.host, port, tls }, handlers);
  running = { tls: tls !== null };
  sweepTimer = setInterval(sweep, 5 * 60_000);
  sweepTimer.unref();
  log.info('Direct devices listening', { port, tls: running.tls, publicHost: publicHost || '(not set)' });
}

export async function stopDirect(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  running = null;
  await stopDeviceEndpoint();
  lives.clear();
  ids.clear();
  failures.clear();
}
