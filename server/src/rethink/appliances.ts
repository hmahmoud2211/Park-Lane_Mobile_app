import { EventEmitter } from 'node:events';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { MqttClient } from './mqtt.ts';

/**
 * LG appliances, through rethink (https://github.com/anszom/rethink), which
 * stands in for LG's ThinQ cloud on the LAN and publishes each appliance to an
 * MQTT broker the way Home Assistant expects (docker/rethink in this repo).
 *
 * Rethink announces each appliance with a discovery message on
 * `homeassistant/device/rethink/<id>/config`. Its `climate` component names
 * the topics for that model. On the DualCool, window and portable ACs, power is
 * commanded on `rethink/<id>/climate-power/set` (ON/OFF) and read back from
 * `rethink/<id>/climate-mode`, which is `off` while the unit is off. Discovery
 * is not retained, so publishing `homeassistant/status online` (as Home
 * Assistant does when it starts) asks rethink to announce everything again.
 */

export type ApplianceKind = 'ac';

export interface LgAppliance {
  id: string;
  name: string;
  model: string | null;
  kind: ApplianceKind;
  online: boolean;
  power: 'on' | 'off' | 'unknown';
}

interface Entry {
  id: string;
  name: string;
  model: string | null;
  powerCommandTopic: string;
  powerStateTopic: string | null;
  modeStateTopic: string | null;
  availabilityTopics: string[];
}

const DEVICE_ID = /^[\w.:-]{1,128}$/;

const entries = new Map<string, Entry>();
/** The last payload on every topic under the rethink prefix (most are retained). */
const values = new Map<string, string>();
/** `change` (applianceId) when an appliance's power or availability may have changed. */
export const applianceEvents = new EventEmitter();
applianceEvents.setMaxListeners(0);

let client: MqttClient | null = null;

export const isConfigured = () => config.rethink.mqttUrl !== '';
export const isConnected = () => client?.connected === true;

/** Reads one discovery message; null for anything that is not an appliance with a power switch. */
export function entryFromDiscovery(id: string, payload: string): Entry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const discovery = parsed as {
    device?: { name?: unknown; model?: unknown };
    availability?: { topic?: unknown }[];
    components?: Record<string, Record<string, unknown>>;
  };
  const climate = Object.values(discovery.components ?? {}).find(
    (component) => component?.platform === 'climate' && typeof component.power_command_topic === 'string',
  );
  if (!climate) {
    return null;
  }
  const topic = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return {
    id,
    name: typeof discovery.device?.name === 'string' ? discovery.device.name : 'LG Air Conditioner',
    model: typeof discovery.device?.model === 'string' ? discovery.device.model : null,
    powerCommandTopic: climate.power_command_topic as string,
    powerStateTopic: topic(climate.power_state_topic),
    modeStateTopic: topic(climate.mode_state_topic),
    availabilityTopics: (discovery.availability ?? [])
      .map((entry) => topic(entry?.topic))
      .filter((value): value is string => value !== null),
  };
}

/** What an appliance's topics say about its power; the mode reads `off` while it is off. */
export function powerOf(entry: Entry, read: (topic: string) => string | undefined): LgAppliance['power'] {
  const power = entry.powerStateTopic ? read(entry.powerStateTopic) : undefined;
  if (power === 'ON' || power === 'OFF') {
    return power === 'ON' ? 'on' : 'off';
  }
  const mode = entry.modeStateTopic ? read(entry.modeStateTopic) : undefined;
  if (mode === undefined || mode === 'None' || mode === '') {
    return 'unknown';
  }
  return mode === 'off' ? 'off' : 'on';
}

function onlineOf(entry: Entry): boolean {
  return isConnected() && entry.availabilityTopics.every((topic) => values.get(topic) === 'online');
}

function toAppliance(entry: Entry): LgAppliance {
  return {
    id: entry.id,
    name: entry.name,
    model: entry.model,
    kind: 'ac',
    online: onlineOf(entry),
    power: powerOf(entry, (topic) => values.get(topic)),
  };
}

function watches(entry: Entry, topic: string): boolean {
  return topic === entry.powerStateTopic || topic === entry.modeStateTopic || entry.availabilityTopics.includes(topic);
}

function receive(topic: string, payload: Buffer): void {
  const text = payload.toString('utf8');
  const discovery = new RegExp(`^${config.rethink.discoveryPrefix}/device/rethink/([^/]+)/config$`).exec(topic);
  if (discovery) {
    const id = discovery[1];
    const entry = DEVICE_ID.test(id) ? entryFromDiscovery(id, text) : null;
    if (entry) {
      const known = entries.has(id);
      entries.set(id, entry);
      if (!known) {
        log.info('LG appliance announced by rethink', { id, model: entry.model });
      }
      applianceEvents.emit('change', id);
    }
    return;
  }
  values.set(topic, text);
  for (const entry of entries.values()) {
    if (watches(entry, topic)) {
      applianceEvents.emit('change', entry.id);
    }
  }
}

/** Connects to the broker rethink publishes to, when RETHINK_MQTT_URL is set. */
export function startRethink(): void {
  if (!isConfigured() || client) {
    return;
  }
  client = new MqttClient(config.rethink.mqttUrl);
  client.on('connect', () => {
    log.info('Connected to the rethink MQTT broker', { broker: client?.url.host });
    client?.subscribe([`${config.rethink.prefix}/#`, `${config.rethink.discoveryPrefix}/device/rethink/+/config`]);
    // Subscriptions are handled in order, so rethink's answer to this arrives after them.
    client?.publish(`${config.rethink.discoveryPrefix}/status`, 'online');
  });
  client.on('close', () => {
    log.warn('Lost the rethink MQTT broker; LG appliances are offline until it is back');
    for (const id of entries.keys()) {
      applianceEvents.emit('change', id);
    }
  });
  client.on('message', (topic: string, payload: Buffer) => receive(topic, payload));
  client.start();
}

export function stopRethink(): void {
  client?.stop();
  client = null;
  entries.clear();
  values.clear();
}

export function listAppliances(): LgAppliance[] {
  return [...entries.values()].map(toAppliance).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function getAppliance(id: string): LgAppliance | null {
  const entry = entries.get(id);
  return entry ? toAppliance(entry) : null;
}

function unavailable(): ApiError {
  return isConfigured()
    ? new ApiError('device_unreachable', 'Rethink, the LG bridge, could not be reached.')
    : new ApiError('not_configured', 'LG appliances are not set up on this backend (RETHINK_MQTT_URL).');
}

/** Resolves once the appliance reports the new state; throws if it does not within `confirmMs`. */
export async function setAppliancePower(id: string, power: 'on' | 'off'): Promise<void> {
  if (!client || !isConnected()) {
    throw unavailable();
  }
  const entry = entries.get(id);
  if (!entry) {
    throw new ApiError('device_unreachable', 'Rethink has not announced this appliance. Is it still paired?');
  }
  if (!onlineOf(entry)) {
    throw new ApiError('device_offline', 'The appliance is not connected to rethink.');
  }
  const read = (topic: string) => values.get(topic);
  if (powerOf(entry, read) === power) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      applianceEvents.off('change', check);
      reject(new ApiError('device_unreachable', 'The appliance did not confirm the change.'));
    }, config.rethink.confirmMs);
    function check(changed: string) {
      if (changed === id && powerOf(entry as Entry, read) === power) {
        clearTimeout(timer);
        applianceEvents.off('change', check);
        resolve();
      }
    }
    applianceEvents.on('change', check);
    if (!client?.publish(entry.powerCommandTopic, power === 'on' ? 'ON' : 'OFF')) {
      clearTimeout(timer);
      applianceEvents.off('change', check);
      reject(unavailable());
    }
  });
}
