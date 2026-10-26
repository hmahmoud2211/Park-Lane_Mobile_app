import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { db } from '../ems/db.ts';
import { publish } from '../ems/events.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { AUDITED, resolveCommand } from './commands.ts';
import { HaConnection, HaError, type ConnectionStatus } from './haClient.ts';
import { toDevices, toRooms } from './mapping.ts';
import { membersOfHub, unitForUser } from './units.ts';
import type { CommandRequest, Device, HaArea, HaDevice, HaEntity, HaState, HubStatus, Registries, Room } from './types.ts';

/**
 * Each unit's Home Assistant hub: its row in the hubs table, and while the
 * backend runs, a HubRuntime holding one connection, the hub's registries
 * and states, and the devices mapped from them.
 *
 * The runtime keeps everything current from HA's own pushes
 * (subscribe_entities, registry events), so reads never wait on HA and
 * residents' open apps get `device`, `device_removed`, `rooms` and
 * `hub_status` events. Changes are coalesced for 250 ms and a device is only
 * pushed when what the app sees actually changed.
 */

export type HubKind = 'container' | 'box';

export interface Hub {
  id: string;
  unitId: string;
  kind: HubKind;
  baseUrl: string | null;
  containerName: string | null;
  haVersion: string | null;
  status: HubStatus;
  lastSeen: string | null;
  lastError: string | null;
}

interface HubRow {
  id: string;
  unit_id: string;
  kind: HubKind;
  base_url: string | null;
  token_sealed: string | null;
  container_name: string | null;
  ha_version: string | null;
  status: HubStatus;
  last_seen: string | null;
  last_error: string | null;
}

const COLUMNS = 'id, unit_id, kind, base_url, token_sealed, container_name, ha_version, status, last_seen, last_error';
const COALESCE_MS = 250;
const REGISTRY_EVENTS = {
  area_registry_updated: 'areas',
  device_registry_updated: 'devices',
  entity_registry_updated: 'entities',
} as const;

const toHub = (row: HubRow): Hub => ({
  id: row.id,
  unitId: row.unit_id,
  kind: row.kind,
  baseUrl: row.base_url,
  containerName: row.container_name,
  haVersion: row.ha_version,
  status: row.status,
  lastSeen: row.last_seen,
  lastError: row.last_error,
});

function hubRow(where: string, value: string): HubRow | undefined {
  return db().prepare(`SELECT ${COLUMNS} FROM hubs WHERE ${where} = ?`).get(value) as HubRow | undefined;
}

export function getHubForUnit(unitId: string): Hub | null {
  const row = hubRow('unit_id', unitId);
  return row ? toHub(row) : null;
}

/** Whether the backend holds a token for the hub (provisioning finished onboarding). */
export function hubHasToken(id: string): boolean {
  return Boolean(hubRow('id', id)?.token_sealed);
}

export function listHubs(): Hub[] {
  return (db().prepare(`SELECT ${COLUMNS} FROM hubs ORDER BY created_at`).all() as unknown as HubRow[]).map(toHub);
}

/** A hub row in `provisioning`, before it has an address or a token. */
export function createHubRow(unitId: string, kind: HubKind, containerName: string | null): Hub {
  const now = new Date().toISOString();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO hubs (id, unit_id, kind, container_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'provisioning', ?, ?)`,
    )
    .run(id, unitId, kind, containerName, now, now);
  return toHub(hubRow('id', id) as HubRow);
}

export function updateHubRow(
  id: string,
  changes: Partial<{ baseUrl: string; token: string; adminPassword: string; status: HubStatus; haVersion: string | null; lastError: string | null; seen: boolean }>,
): void {
  const sets: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [new Date().toISOString()];
  const set = (column: string, value: string | null) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (changes.baseUrl !== undefined) set('base_url', changes.baseUrl);
  if (changes.token !== undefined) set('token_sealed', seal(changes.token));
  if (changes.adminPassword !== undefined) set('admin_password_sealed', seal(changes.adminPassword));
  if (changes.status !== undefined) set('status', changes.status);
  if (changes.haVersion !== undefined) set('ha_version', changes.haVersion);
  if (changes.lastError !== undefined) set('last_error', changes.lastError);
  if (changes.seen) set('last_seen', new Date().toISOString());
  db()
    .prepare(`UPDATE hubs SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id);
}

// ---- Runtime -------------------------------------------------------------------------------

interface ChangeWaiter {
  entityId: string;
  resolve: () => void;
}

interface CompressedState {
  s?: string;
  a?: Record<string, unknown>;
  lc?: number;
  lu?: number;
}

interface EntitiesEvent {
  a?: Record<string, CompressedState>;
  c?: Record<string, { '+'?: CompressedState; '-'?: { a?: string[] } }>;
  r?: string[];
}

function normalizeDevice(device: HaDevice & { config_entries?: string[] }): HaDevice {
  return { ...device, config_entry_id: device.config_entry_id ?? device.config_entries?.[0] ?? null };
}

export class HubRuntime {
  readonly hubId: string;
  readonly connection: HaConnection;
  /** Offline until this process has connected, whatever the row says from before a restart. */
  status: HubStatus = 'offline';
  private registries: Registries = { areas: new Map(), devices: new Map(), entities: new Map() };
  private readonly states = new Map<string, HaState>();
  private devices = new Map<string, Device>();
  private shown = new Map<string, string>();
  private rooms: Room[] = [];
  private roomsShown = '';
  private loaded = false;
  private readonly pending = new Map<string, Device['pending']>();
  private readonly lastErrors = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private waiters: ChangeWaiter[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private registryTimers = new Map<keyof Registries, NodeJS.Timeout>();

  constructor(hub: Hub, token: string) {
    this.hubId = hub.id;
    this.connection = new HaConnection({
      baseUrl: hub.baseUrl as string,
      token,
      commandTimeoutMs: config.ha.commandTimeoutMs,
      onReady: (connection) => this.bootstrap(connection),
      onStatus: (status, detail) => this.onStatus(status, detail),
    });
  }

  start() {
    this.connection.start();
  }

  stop() {
    this.connection.stop();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const timer of this.registryTimers.values()) clearTimeout(timer);
  }

  // ---- Reads -------------------------------------------------------------------------------

  /** Devices as last seen; empty until the first connection, hub_offline if there never was one. */
  listDevices(): Device[] {
    this.requireLoaded();
    return [...this.devices.values()];
  }

  getDevice(id: string): Device {
    this.requireLoaded();
    const device = this.devices.get(id);
    if (!device) {
      throw new ApiError('not_found', 'No such device in your home.');
    }
    return device;
  }

  listRooms(): Room[] {
    this.requireLoaded();
    return this.rooms;
  }

  private requireLoaded() {
    if (!this.loaded) {
      throw this.status === 'auth_failed'
        ? new ApiError('hub_auth', 'Your home hub refused the backend. Building management has been told.')
        : new ApiError('hub_offline', 'Your home hub is not reachable right now. Try again in a moment.');
    }
  }

  private requireOnline() {
    if (this.status !== 'online') {
      throw this.status === 'auth_failed'
        ? new ApiError('hub_auth', 'Your home hub refused the backend. Building management has been told.')
        : new ApiError('hub_offline', 'Your home hub is not reachable right now. Try again in a moment.');
    }
  }

  // ---- Writes ------------------------------------------------------------------------------

  /**
   * Runs one allowlisted command and resolves with the device as the hub then
   * reports it. Shown as pending to every open app until the hub answers.
   */
  async command(userId: string, deviceId: string, request: CommandRequest): Promise<Device> {
    this.requireOnline();
    const device = this.getDevice(deviceId);
    const { call } = resolveCommand(device, request);
    if (this.inFlight.has(call.entityId)) {
      throw new ApiError('conflict', 'This device is still busy with the last command.');
    }
    this.inFlight.add(call.entityId);
    this.pending.set(deviceId, { entityId: call.entityId, capability: request.capability, action: request.action });
    this.lastErrors.delete(deviceId);
    this.recompute(true);
    if (AUDITED.has(`${call.domain}.${call.service}`)) {
      db()
        .prepare('INSERT INTO audit_log (user_id, hub_id, action, target, at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, this.hubId, `${call.domain}.${call.service}`, call.entityId, new Date().toISOString());
    }

    const changed = this.waitForChange(call.entityId, config.ha.commandTimeoutMs);
    try {
      await this.connection.command({
        type: 'call_service',
        domain: call.domain,
        service: call.service,
        target: { entity_id: call.entityId },
        service_data: call.data,
      });
      // Cloud devices report back after the call returns; a state that was
      // already right never changes, so running out of time is not a failure.
      await changed.promise;
    } catch (error) {
      changed.cancel();
      const message = error instanceof HaError ? error.message : 'The hub could not run the command.';
      this.lastErrors.set(deviceId, message);
      throw error instanceof HaError && error.code === 'not_connected'
        ? new ApiError('hub_offline', 'Your home hub is not reachable right now. Try again in a moment.')
        : new ApiError('ha_rejected', message);
    } finally {
      this.inFlight.delete(call.entityId);
      this.pending.delete(deviceId);
      this.recompute(true);
    }
    return this.getDevice(deviceId);
  }

  /** Renames a device or moves it to a room; both live in Home Assistant's registries. */
  async updateDevice(deviceId: string, changes: { name?: unknown; roomId?: unknown }): Promise<Device> {
    this.requireOnline();
    this.getDevice(deviceId);
    const update: Record<string, unknown> = {};
    if (changes.name !== undefined) {
      const name = typeof changes.name === 'string' ? changes.name.trim().slice(0, 64) : '';
      if (!name) {
        throw new ApiError('bad_request', 'The name cannot be empty.');
      }
      update.name = name;
    }
    if (changes.roomId !== undefined) {
      if (changes.roomId !== null && (typeof changes.roomId !== 'string' || !this.registries.areas.has(changes.roomId))) {
        throw new ApiError('bad_request', 'No such room.');
      }
      update.area_id = changes.roomId;
    }
    if (Object.keys(update).length === 0) {
      throw new ApiError('bad_request', 'Nothing to change: send name and/or roomId.');
    }
    try {
      if (deviceId.startsWith('e.')) {
        await this.connection.command({ type: 'config/entity_registry/update', entity_id: deviceId.slice(2), ...update });
        await this.reloadRegistry('entities');
      } else {
        const { name, ...rest } = update;
        await this.connection.command({
          type: 'config/device_registry/update',
          device_id: deviceId,
          ...rest,
          ...(name !== undefined ? { name_by_user: name } : {}),
        });
        await this.reloadRegistry('devices');
      }
    } catch (error) {
      throw new ApiError('ha_rejected', (error as Error).message);
    }
    return this.getDevice(deviceId);
  }

  async createRoom(nameInput: unknown): Promise<Room> {
    this.requireOnline();
    const name = typeof nameInput === 'string' ? nameInput.trim().slice(0, 48) : '';
    if (!name) {
      throw new ApiError('bad_request', 'The room needs a name.');
    }
    let area: HaArea;
    try {
      area = await this.connection.command<HaArea>({ type: 'config/area_registry/create', name });
    } catch (error) {
      throw new ApiError(
        error instanceof HaError && error.code === 'invalid_info' ? 'conflict' : 'ha_rejected',
        (error as Error).message,
      );
    }
    await this.reloadRegistry('areas');
    return this.rooms.find((room) => room.id === area.area_id) ?? { id: area.area_id, name: area.name, icon: area.icon, deviceCount: 0 };
  }

  // ---- Keeping current ---------------------------------------------------------------------

  private async bootstrap(connection: HaConnection) {
    const [areas, devices, entities] = await Promise.all([
      connection.command<HaArea[]>({ type: 'config/area_registry/list' }),
      connection.command<HaDevice[]>({ type: 'config/device_registry/list' }),
      connection.command<HaEntity[]>({ type: 'config/entity_registry/list' }),
    ]);
    this.registries = {
      areas: new Map(areas.map((area) => [area.area_id, area])),
      devices: new Map(devices.map((device) => [device.id, normalizeDevice(device)])),
      entities: new Map(entities.map((entity) => [entity.entity_id, entity])),
    };
    this.states.clear();
    let first: () => void = () => undefined;
    const initial = new Promise<void>((resolve) => {
      first = resolve;
    });
    await connection.subscribe({ type: 'subscribe_entities' }, (event) => {
      this.applyStates(event as EntitiesEvent);
      first();
    });
    for (const [eventType, registry] of Object.entries(REGISTRY_EVENTS)) {
      await connection.subscribe({ type: 'subscribe_events', event_type: eventType }, () => this.scheduleRegistry(registry));
    }
    // HA sends every current state as the subscription's first event.
    await initial;
    this.loaded = true;
    this.recompute(true);
  }

  private applyStates(event: EntitiesEvent) {
    for (const [entityId, state] of Object.entries(event.a ?? {})) {
      this.states.set(entityId, { state: state.s ?? 'unknown', attributes: state.a ?? {}, lastChanged: state.lc ?? null });
      this.wake(entityId);
    }
    for (const [entityId, diff] of Object.entries(event.c ?? {})) {
      const current = this.states.get(entityId);
      if (!current) {
        continue;
      }
      const added = diff['+'] ?? {};
      const attributes = { ...current.attributes, ...(added.a ?? {}) };
      for (const removed of diff['-']?.a ?? []) {
        delete attributes[removed];
      }
      this.states.set(entityId, {
        state: added.s ?? current.state,
        attributes,
        lastChanged: added.lc ?? current.lastChanged,
      });
      this.wake(entityId);
    }
    for (const entityId of event.r ?? []) {
      this.states.delete(entityId);
    }
    this.recompute(false);
  }

  private scheduleRegistry(registry: keyof Registries) {
    if (this.registryTimers.has(registry)) {
      return;
    }
    this.registryTimers.set(
      registry,
      setTimeout(() => {
        this.registryTimers.delete(registry);
        this.reloadRegistry(registry).catch((error: unknown) =>
          log.warn('Reloading a Home Assistant registry failed', { hub: this.hubId, registry, reason: (error as Error).message }),
        );
      }, 500),
    );
  }

  private async reloadRegistry(registry: keyof Registries) {
    if (registry === 'areas') {
      const areas = await this.connection.command<HaArea[]>({ type: 'config/area_registry/list' });
      this.registries.areas = new Map(areas.map((area) => [area.area_id, area]));
    } else if (registry === 'devices') {
      const devices = await this.connection.command<HaDevice[]>({ type: 'config/device_registry/list' });
      this.registries.devices = new Map(devices.map((device) => [device.id, normalizeDevice(device)]));
    } else {
      const entities = await this.connection.command<HaEntity[]>({ type: 'config/entity_registry/list' });
      this.registries.entities = new Map(entities.map((entity) => [entity.entity_id, entity]));
    }
    this.recompute(true);
  }

  /** Maps everything again; pushes now, or after the coalescing window. */
  private recompute(now: boolean) {
    if (!this.loaded) {
      return;
    }
    if (!now) {
      this.flushTimer ??= setTimeout(() => {
        this.flushTimer = null;
        this.recompute(true);
      }, COALESCE_MS);
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const next = new Map<string, Device>();
    for (const device of toDevices(this.registries, this.states)) {
      next.set(device.id, { ...device, pending: this.pending.get(device.id) ?? null, lastError: this.lastErrors.get(device.id) ?? null });
    }
    const members = membersOfHub(this.hubId);
    const shown = new Map<string, string>();
    for (const [id, device] of next) {
      const json = JSON.stringify(device);
      shown.set(id, json);
      if (this.shown.get(id) !== json) {
        members.forEach((userId) => publish(userId, { type: 'device', device }));
      }
    }
    for (const id of this.shown.keys()) {
      if (!next.has(id)) {
        members.forEach((userId) => publish(userId, { type: 'device_removed', id }));
      }
    }
    this.devices = next;
    this.shown = shown;

    const rooms = toRooms(this.registries, [...next.values()]);
    const roomsJson = JSON.stringify(rooms);
    if (roomsJson !== this.roomsShown) {
      members.forEach((userId) => publish(userId, { type: 'rooms', rooms }));
    }
    this.rooms = rooms;
    this.roomsShown = roomsJson;
  }

  private waitForChange(entityId: string, timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
    let waiter: ChangeWaiter | null = null;
    let timer: NodeJS.Timeout | null = null;
    const promise = new Promise<void>((resolve) => {
      const done = () => {
        if (timer) clearTimeout(timer);
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        resolve();
      };
      waiter = { entityId, resolve: done };
      this.waiters.push(waiter);
      timer = setTimeout(done, timeoutMs);
    });
    return { promise, cancel: () => waiter?.resolve() };
  }

  private wake(entityId: string) {
    for (const waiter of this.waiters.filter((entry) => entry.entityId === entityId)) {
      waiter.resolve();
    }
  }

  private onStatus(status: ConnectionStatus, detail: { haVersion?: string; error?: string }) {
    const next: HubStatus = status === 'connecting' ? this.status : status;
    if (status === 'online') {
      updateHubRow(this.hubId, { status: 'online', haVersion: detail.haVersion ?? null, lastError: null, seen: true });
    } else if (status === 'offline' || status === 'auth_failed') {
      updateHubRow(this.hubId, { status, lastError: detail.error ?? null });
    }
    if (next !== this.status) {
      this.status = next;
      const message = { type: 'hub_status', status: next, haVersion: detail.haVersion ?? this.connection.haVersion };
      membersOfHub(this.hubId).forEach((userId) => publish(userId, message));
      log.info('Home hub status', { hub: this.hubId, status: next });
    }
  }
}

// ---- Registry of running hubs -------------------------------------------------------------

const runtimes = new Map<string, HubRuntime>();

/** Connects to a hub that has an address and a token, replacing any earlier connection. */
export function startHub(hubId: string): HubRuntime | null {
  runtimes.get(hubId)?.stop();
  runtimes.delete(hubId);
  const row = hubRow('id', hubId);
  if (!row?.base_url || !row.token_sealed) {
    return null;
  }
  const runtime = new HubRuntime(toHub(row), unseal(row.token_sealed));
  runtimes.set(hubId, runtime);
  runtime.start();
  return runtime;
}

export function stopHub(hubId: string): void {
  runtimes.get(hubId)?.stop();
  runtimes.delete(hubId);
}

/** At boot: connect to every hub that finished provisioning. */
export function startHubs(): void {
  for (const hub of listHubs()) {
    if (hub.status !== 'provisioning' && hub.status !== 'failed') {
      startHub(hub.id);
    }
  }
}

export function stopHubs(): void {
  for (const id of [...runtimes.keys()]) {
    stopHub(id);
  }
}

export function runtimeStatus(hubId: string): HubStatus | null {
  return runtimes.get(hubId)?.status ?? null;
}

/** The running hub for a resident's unit, or the reason there is none. */
export function runtimeForUser(userId: string): HubRuntime {
  const unit = unitForUser(userId);
  const hub = getHubForUnit(unit.id);
  if (!hub || hub.status === 'provisioning') {
    throw new ApiError('provisioning', 'Your smart home is still being set up. Try again in a few minutes.');
  }
  const runtime = runtimes.get(hub.id);
  if (!runtime) {
    throw new ApiError('hub_offline', 'Your home hub is not available right now.');
  }
  return runtime;
}
