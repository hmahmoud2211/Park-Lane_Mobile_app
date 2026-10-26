import { EventEmitter } from 'node:events';

import { config } from '../config.ts';
import * as cube from '../cube/cubeClient.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { decodeTxt, powerOf, sendSwitch } from './lanProtocol.ts';
import { EwelinkBrowser, type EwelinkService } from './mdns.ts';
import * as store from './store.ts';

/**
 * Bridges SONOFF plugs to the CUBE hub as third-party devices:
 *
 *   app -> backend -> CUBE  (register, switch)
 *   CUBE -> backend -> plug (the hub posts UpdateDeviceStates to our service
 *                            address; we send the LAN command)
 *   plug -> backend -> CUBE (mDNS announcements -> state and online reports)
 *
 * A plug is only registered once it has been seen on the LAN with state the
 * bridge can read, so the hub never lists a device nothing can drive.
 */

export const browser = new EwelinkBrowser(config.mdns.interface);

/**
 * A bridged plug's state or reachability changed, by whatever cause: a
 * command the hub sent, its own button, or going quiet. The EMS registry
 * listens (ems/adapters/cube.ts) so the app updates live.
 */
export const plugEvents = new EventEmitter<{
  change: [{ cubeSerial: string; power?: 'on' | 'off'; online?: boolean }];
}>();

export interface LanDeviceView {
  deviceId: string;
  host: string;
  port: number;
  encrypted: boolean;
  keyVerified: boolean | null;
  power: 'on' | 'off' | null;
  singleChannel: boolean;
}

function view(service: EwelinkService, deviceKey?: string): LanDeviceView {
  const state = decodeTxt(service.txt, deviceKey);
  return {
    deviceId: service.deviceId,
    host: service.host,
    port: service.port || config.lan.defaultPort,
    encrypted: state.encrypted,
    keyVerified: state.keyVerified,
    power: powerOf(state.params),
    // Multi-channel devices report `switches` instead.
    singleChannel: state.params ? powerOf(state.params) !== null : false,
  };
}

function requireBrowser() {
  if (!browser.listening) {
    throw new ApiError('mdns_unavailable', 'The backend could not open mDNS, so it cannot see devices on the LAN.');
  }
}

/** Looks for the plug's announcement; with its key, also checks the key and reads its state. */
export async function discover(deviceId: string, deviceKey?: string): Promise<LanDeviceView | null> {
  requireBrowser();
  const service = await browser.lookFor(deviceId, config.mdns.queryWindowMs);
  return service ? view(service, deviceKey) : null;
}

const thirdSerialOf = (deviceId: string) => `sonoff-${deviceId}`;

export interface Registration {
  cubeSerial: string;
  created: boolean;
  device: LanDeviceView;
}

/**
 * Registers a plug with the hub. Refuses unless it is on the LAN, its key
 * reads its state (or it announces plainly, as in DIY mode), and it is a
 * single-channel switch, which is the one capability the bridge drives.
 */
export async function register(deviceId: string, deviceKey: string, name: string): Promise<Registration> {
  if (!config.publicUrl) {
    throw new ApiError(
      'public_url_missing',
      'The backend has no PUBLIC_URL, so the hub would have nowhere to send commands.',
    );
  }

  const device = await discover(deviceId, deviceKey);
  if (!device) {
    throw new ApiError('device_not_found', 'The plug is not announcing itself on the LAN.');
  }
  if (device.encrypted && device.keyVerified !== true) {
    throw new ApiError('key_rejected', 'The plug’s key did not decrypt its announcement.');
  }
  if (!device.singleChannel || device.power === null) {
    throw new ApiError('unsupported_device', 'The plug does not report a single on/off switch.');
  }

  const thirdSerial = thirdSerialOf(deviceId);
  const existing = await store.findPlug({ deviceId });
  const base = {
    deviceId,
    deviceKey,
    name,
    thirdSerial,
    host: device.host,
    port: device.port,
    encrypted: device.encrypted,
    power: device.power,
    online: true,
    missedRounds: 0,
  };

  // Already on the hub: refresh what the bridge knows rather than add a second copy.
  if (existing) {
    const onHub = await cube.getDevice(existing.cubeSerial);
    if (onHub) {
      await store.upsertPlug({ ...existing, ...base, cubeSerial: existing.cubeSerial });
      await cube.reportOnline(existing.cubeSerial, thirdSerial, true).catch(() => undefined);
      return { cubeSerial: existing.cubeSerial, created: false, device };
    }
  }

  const secret = await store.directiveSecret();
  const cubeSerial = await cube.syncThirdPartyDevice({
    third_serial_number: thirdSerial,
    name,
    display_category: 'plug',
    // Controllable and reportable, as the CUBE docs declare power; the hub
    // does not configure soft start, so there is no configure bit.
    capabilities: [{ capability: 'power', permission: '1100' }],
    state: { power: { powerState: device.power } },
    manufacturer: 'SONOFF',
    // The plug does not report its model on the LAN; this says how it is driven.
    model: device.encrypted ? 'Wi-Fi plug (eWeLink LAN)' : 'Wi-Fi plug (DIY LAN)',
    firmware_version: 'unknown',
    service_address: `${config.publicUrl}/cube/directive/${secret}`,
    tags: { deviceid: deviceId, bridge: 'parklane-backend' },
  });

  await store.upsertPlug({ ...base, cubeSerial, registeredAt: new Date().toISOString() });
  log.info('SONOFF plug registered with the hub', { deviceId, cubeSerial });
  return { cubeSerial, created: true, device };
}

// ---- Commands from the hub ---------------------------------------------------------

interface Directive {
  directive?: {
    header?: { name?: string; message_id?: string; version?: string };
    endpoint?: { serial_number?: string; third_serial_number?: string };
    payload?: { state?: { power?: { powerState?: 'on' | 'off' | 'toggle' } } };
  };
}

function reply(header: { message_id?: string; version?: string } | undefined, name: string, payload: object) {
  return {
    event: {
      header: { name, message_id: header?.message_id ?? '', version: header?.version ?? '2' },
      payload,
    },
  };
}

/** Answers a directive the hub posted to our service address; the hub waits 3 seconds at most. */
export async function handleDirective(body: Directive): Promise<object> {
  const header = body.directive?.header;
  const endpoint = body.directive?.endpoint;
  // Our own serial first; the hub's only when it leaves ours out.
  const plug = endpoint?.third_serial_number
    ? await store.findPlug({ thirdSerial: endpoint.third_serial_number })
    : endpoint?.serial_number
      ? await store.findPlug({ cubeSerial: endpoint.serial_number })
      : undefined;
  if (!plug) {
    return reply(header, 'ErrorResponse', { type: 'NO_SUCH_ENDPOINT' });
  }

  if (header?.name === 'QueryDeviceStates') {
    return plug.power
      ? reply(header, 'Response', { state: { power: { powerState: plug.power } } })
      : reply(header, 'ErrorResponse', { type: 'ENDPOINT_UNREACHABLE' });
  }
  if (header?.name !== 'UpdateDeviceStates') {
    return reply(header, 'ErrorResponse', { type: 'INVALID_DIRECTIVE' });
  }

  const requested = body.directive?.payload?.state?.power?.powerState;
  if (requested !== 'on' && requested !== 'off' && requested !== 'toggle') {
    return reply(header, 'ErrorResponse', { type: 'INVALID_DIRECTIVE' });
  }
  const power = requested === 'toggle' ? (plug.power === 'on' ? 'off' : 'on') : requested;

  const result = await sendSwitch(plug, power);
  if (result !== 'ok') {
    log.warn('SONOFF command failed', { deviceId: plug.deviceId, result });
    return reply(header, 'ErrorResponse', { type: 'ENDPOINT_UNREACHABLE' });
  }
  await store.updatePlug(plug.deviceId, { power, online: true, missedRounds: 0 });
  plugEvents.emit('change', { cubeSerial: plug.cubeSerial, power, online: true });
  return reply(header, 'UpdateDeviceStatesResponse', {});
}

// ---- Keeping the hub up to date ----------------------------------------------------

/** On every announcement from a registered plug: new address, new state, back online. */
async function onAnnouncement(service: EwelinkService): Promise<void> {
  const plug = await store.findPlug({ deviceId: service.deviceId });
  if (!plug) {
    return;
  }
  const current = view(service, plug.deviceKey);
  const changes: Partial<store.StoredPlug> = { host: current.host, port: current.port, missedRounds: 0 };
  if (!plug.online) {
    changes.online = true;
    await cube.reportOnline(plug.cubeSerial, plug.thirdSerial, true).catch(() => undefined);
  }
  if (current.power && current.power !== plug.power) {
    changes.power = current.power;
    await cube
      .reportState(plug.cubeSerial, plug.thirdSerial, { power: { powerState: current.power } })
      .catch((error: unknown) => log.warn('State report to the hub failed', { reason: (error as Error).message }));
  }
  await store.updatePlug(plug.deviceId, changes);
  if (changes.online || changes.power) {
    plugEvents.emit('change', { cubeSerial: plug.cubeSerial, online: true, ...(changes.power ? { power: changes.power } : {}) });
  }
}

/** Asks the LAN regularly; plugs silent for a few rounds are reported offline. */
async function monitorRound(): Promise<void> {
  const plugs = await store.listPlugs();
  if (plugs.length === 0) {
    return;
  }
  const startedAt = Date.now();
  browser.query();
  await new Promise((resolve) => setTimeout(resolve, config.mdns.queryWindowMs));
  for (const plug of plugs) {
    if (browser.find(plug.deviceId, startedAt)) {
      continue;
    }
    const missedRounds = plug.missedRounds + 1;
    await store.updatePlug(plug.deviceId, { missedRounds });
    if (plug.online && missedRounds >= config.mdns.offlineAfterMisses) {
      await store.updatePlug(plug.deviceId, { online: false });
      await cube.reportOnline(plug.cubeSerial, plug.thirdSerial, false).catch(() => undefined);
      plugEvents.emit('change', { cubeSerial: plug.cubeSerial, online: false });
      log.warn('SONOFF plug went quiet; reported offline', { deviceId: plug.deviceId });
    }
  }
}

export async function startBridge(): Promise<void> {
  try {
    await browser.start();
  } catch (error) {
    log.error('mDNS could not start; SONOFF discovery is off', { reason: (error as Error).message });
    return;
  }
  browser.on('service', (service) => {
    void onAnnouncement(service).catch(() => undefined);
  });
  setInterval(() => {
    void monitorRound().catch((error: unknown) =>
      log.warn('Monitor round failed', { reason: (error as Error).message }),
    );
  }, config.mdns.monitorIntervalMs).unref();
}
