import { EventEmitter } from 'node:events';

import { config } from '../config.ts';
import type { ControlSetting, DeviceControls } from '../ems/adapters/types.ts';
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
 *
 * The same climate component names the topics for mode, set point, fan speed
 * and both swings. The other components are the unit's extras as Home
 * Assistant entities: switches (Jet, Air purify), numbers (the timers),
 * selects, a button (filter reset) and sensors (filter hours, power draw).
 * Rethink only announces what the unit says it supports, so each model gets
 * exactly its own controls.
 *
 * Rethink publishes a value only when the unit reports a change. Switches it
 * marks `optimistic` are not echoed in every state (Air purify set while the
 * AC is off is applied at power-up), so, as in Home Assistant, the value sent
 * is assumed. Features that only work in some states (Jet in Cooling or
 * Heating) have their own availability topic, and a JSON attributes topic
 * saying what they need.
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

/** A setting or reading, with the topics behind it. */
interface Control {
  key: string;
  kind: ControlSetting['kind'];
  name: string;
  stateTopic: string | null;
  commandTopic: string | null;
  options: string[] | null;
  min: number;
  max: number;
  step: number;
  unit: string | null;
  payloadOn: string;
  payloadOff: string;
  payloadPress: string;
  /** Not echoed in every state, so the value sent is assumed. */
  optimistic: boolean;
  /** A binary_sensor: ON and OFF read as true and false. */
  binary: boolean;
  /** Topics that must all read `online` for it to be usable, e.g. Jet's "in Cooling or Heating". */
  availabilityTopics: string[];
  attributesTopic: string | null;
  diagnostic: boolean;
  /** A climate setting, which the unit only takes while it runs. */
  needsPower: boolean;
}

interface Entry {
  id: string;
  name: string;
  model: string | null;
  powerCommandTopic: string;
  powerStateTopic: string | null;
  modeStateTopic: string | null;
  actionTopic: string | null;
  currentTemperatureTopic: string | null;
  currentHumidityTopic: string | null;
  availabilityTopics: string[];
  controls: Control[];
}

const DEVICE_ID = /^[\w.:-]{1,128}$/;
const CONTROL_KEY = /^[\w-]{1,64}$/;

/** The climate settings in the order the app shows them, with Home Assistant's defaults for the lists. */
const CLIMATE_SETTINGS: readonly { key: string; name: string; options?: string; defaults?: readonly string[] }[] = [
  { key: 'mode', name: 'Mode', options: 'modes', defaults: ['auto', 'off', 'cool', 'heat', 'dry', 'fan_only'] },
  { key: 'temperature', name: 'Temperature' },
  { key: 'fan_mode', name: 'Fan speed', options: 'fan_modes', defaults: ['auto', 'low', 'medium', 'high'] },
  { key: 'swing_mode', name: 'Vertical airflow', options: 'swing_modes', defaults: ['on', 'off'] },
  { key: 'swing_horizontal_mode', name: 'Horizontal airflow', options: 'swing_horizontal_modes', defaults: ['on', 'off'] },
];

/** The Home Assistant platforms the app can show, and how. */
const PLATFORMS: Record<string, ControlSetting['kind']> = {
  switch: 'switch',
  number: 'number',
  select: 'select',
  button: 'button',
  sensor: 'sensor',
  binary_sensor: 'sensor',
};

/** What rethink and Home Assistant publish for "no value". */
const UNSET = new Set(['', 'None', 'unknown', 'unavailable']);

const entries = new Map<string, Entry>();
/** The last payload on every topic under the rethink prefix (most are retained). */
const values = new Map<string, string>();
/** `change` (applianceId) when anything an appliance reports may have changed. */
export const applianceEvents = new EventEmitter();
applianceEvents.setMaxListeners(0);

let client: MqttClient | null = null;

export const isConfigured = () => config.rethink.mqttUrl !== '';
export const isConnected = () => client?.connected === true;

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const strings = (value: unknown) =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string') ? (value as string[]) : null;
const topics = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => text((entry as { topic?: unknown } | null)?.topic))
    .filter((topic): topic is string => topic !== null);

function control(fields: Partial<Control> & Pick<Control, 'key' | 'kind' | 'name'>): Control {
  return {
    stateTopic: null,
    commandTopic: null,
    options: null,
    min: 0,
    max: 0,
    step: 1,
    unit: null,
    payloadOn: 'ON',
    payloadOff: 'OFF',
    payloadPress: 'PRESS',
    optimistic: false,
    binary: false,
    availabilityTopics: [],
    attributesTopic: null,
    diagnostic: false,
    needsPower: false,
    ...fields,
  };
}

function climateControls(climate: Record<string, unknown>): Control[] {
  const result: Control[] = [];
  for (const setting of CLIMATE_SETTINGS) {
    const commandTopic = text(climate[`${setting.key}_command_topic`]);
    if (!commandTopic) {
      continue;
    }
    const stateTopic = text(climate[`${setting.key}_state_topic`]);
    const shared = { key: setting.key, name: setting.name, commandTopic, stateTopic, needsPower: true, optimistic: !stateTopic };
    if (!setting.options) {
      result.push(
        control({
          ...shared,
          kind: 'number',
          min: num(climate.min_temp, 7),
          max: num(climate.max_temp, 35),
          step: num(climate.temp_step, 1),
          unit: climate.temperature_unit === 'F' ? '°F' : '°C',
        }),
      );
      continue;
    }
    const options = strings(climate[setting.options]) ?? setting.defaults ?? [];
    // Off is the power switch's job.
    result.push(control({ ...shared, kind: 'select', options: options.filter((option) => setting.key !== 'mode' || option !== 'off') }));
  }
  return result;
}

function componentControl(key: string, component: Record<string, unknown>): Control | null {
  const kind = PLATFORMS[String(component.platform)];
  if (!kind || !CONTROL_KEY.test(key)) {
    return null;
  }
  const stateTopic = text(component.state_topic);
  const commandTopic = text(component.command_topic);
  const options = strings(component.options);
  // Withdrawn components carry only their platform.
  if ((kind === 'sensor' ? !stateTopic : !commandTopic) || (kind === 'select' && !options)) {
    return null;
  }
  return control({
    key,
    kind,
    name: text(component.name) ?? key,
    stateTopic: kind === 'button' ? null : stateTopic,
    commandTopic: kind === 'sensor' ? null : commandTopic,
    options: kind === 'select' ? options : null,
    ...(kind === 'number' ? { min: num(component.min, 1), max: num(component.max, 100), step: num(component.step, 1) } : {}),
    unit: text(component.unit_of_measurement),
    payloadOn: text(component.payload_on) ?? 'ON',
    payloadOff: text(component.payload_off) ?? 'OFF',
    payloadPress: text(component.payload_press) ?? 'PRESS',
    optimistic: component.optimistic === true || (kind !== 'button' && kind !== 'sensor' && !stateTopic),
    binary: component.platform === 'binary_sensor',
    availabilityTopics: topics(component.availability),
    attributesTopic: text(component.json_attributes_topic),
    diagnostic: component.entity_category === 'diagnostic',
  });
}

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
    availability?: unknown;
    components?: Record<string, unknown>;
  };
  const components = Object.entries(discovery?.components ?? {}).filter(
    (pair): pair is [string, Record<string, unknown>] => typeof pair[1] === 'object' && pair[1] !== null,
  );
  const climate = components.find(
    ([, component]) => component.platform === 'climate' && typeof component.power_command_topic === 'string',
  );
  if (!climate) {
    return null;
  }
  const [climateKey, climateComponent] = climate;
  return {
    id,
    name: typeof discovery.device?.name === 'string' ? discovery.device.name : 'LG Air Conditioner',
    model: typeof discovery.device?.model === 'string' ? discovery.device.model : null,
    powerCommandTopic: climateComponent.power_command_topic as string,
    powerStateTopic: text(climateComponent.power_state_topic),
    modeStateTopic: text(climateComponent.mode_state_topic),
    actionTopic: text(climateComponent.action_topic),
    currentTemperatureTopic: text(climateComponent.current_temperature_topic),
    currentHumidityTopic: text(climateComponent.current_humidity_topic),
    availabilityTopics: topics(discovery.availability),
    controls: [
      ...climateControls(climateComponent),
      ...components
        .filter(([key]) => key !== climateKey)
        .map(([key, component]) => componentControl(key, component))
        .filter((entry): entry is Control => entry !== null),
    ],
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

const currentPower = (entry: Entry) => powerOf(entry, (topic) => values.get(topic));

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
    power: currentPower(entry),
  };
}

function read(topic: string | null): string | null {
  const value = topic ? values.get(topic) : undefined;
  return value === undefined || UNSET.has(value) ? null : value;
}

function numberAt(topic: string | null): number | null {
  const value = read(topic);
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function valueOf(setting: Control): ControlSetting['value'] {
  const raw = read(setting.stateTopic);
  if (raw === null) {
    return null;
  }
  if (setting.kind === 'switch' || setting.binary) {
    return raw === setting.payloadOn ? true : raw === setting.payloadOff ? false : null;
  }
  if (setting.kind === 'number') {
    return numberAt(setting.stateTopic);
  }
  if (setting.kind === 'sensor') {
    // Rethink's date for a filter that was never reset.
    if (raw.startsWith('0000-00-00')) {
      return null;
    }
    return Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return raw;
}

function attributesOf(setting: Control): { description: string | null; requires: string | null } {
  let parsed: unknown = null;
  try {
    parsed = setting.attributesTopic ? JSON.parse(values.get(setting.attributesTopic) ?? 'null') : null;
  } catch {
    // Shown without them.
  }
  const attributes = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const requires = text(attributes.requires);
  return {
    description: text(attributes.description),
    // Rethink says "nothing, always available" for features that work in any state.
    requires: setting.needsPower ? 'AC on' : requires && !requires.startsWith('nothing') ? requires : null,
  };
}

function availableOf(entry: Entry, setting: Control, power: LgAppliance['power']): boolean {
  return (
    onlineOf(entry) &&
    (!setting.needsPower || power === 'on') &&
    setting.availabilityTopics.every((topic) => values.get(topic) === 'online')
  );
}

function receive(topic: string, payload: Buffer): void {
  const message = payload.toString('utf8');
  const discovery = new RegExp(`^${config.rethink.discoveryPrefix}/device/rethink/([^/]+)/config$`).exec(topic);
  if (discovery) {
    const id = discovery[1];
    const entry = DEVICE_ID.test(id) ? entryFromDiscovery(id, message) : null;
    if (entry) {
      const known = entries.has(id);
      entries.set(id, entry);
      if (!known) {
        log.info('LG appliance announced by rethink', { id, model: entry.model, controls: entry.controls.length });
      }
      applianceEvents.emit('change', id);
    }
    return;
  }
  values.set(topic, message);
  for (const entry of entries.values()) {
    if (topic.startsWith(`${config.rethink.prefix}/${entry.id}/`) || entry.availabilityTopics.includes(topic)) {
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

const notAnnounced = () => new ApiError('device_unreachable', 'Rethink has not announced this appliance. Is it still paired?');

/** Everything the appliance can be set to and reports, as the app shows it. */
export function applianceControls(id: string): DeviceControls {
  const entry = entries.get(id);
  if (!entry) {
    throw isConnected() ? notAnnounced() : unavailable();
  }
  const power = currentPower(entry);
  return {
    online: onlineOf(entry),
    power,
    action: read(entry.actionTopic),
    currentTemperature: numberAt(entry.currentTemperatureTopic),
    currentHumidity: numberAt(entry.currentHumidityTopic),
    settings: entry.controls.map((setting) => ({
      key: setting.key,
      kind: setting.kind,
      name: setting.name,
      value: valueOf(setting),
      ...(setting.options ? { options: setting.options } : {}),
      ...(setting.kind === 'number' ? { min: setting.min, max: setting.max, step: setting.step } : {}),
      unit: setting.unit,
      available: availableOf(entry, setting, power),
      ...attributesOf(setting),
      diagnostic: setting.diagnostic,
    })),
  };
}

/** The appliance, when a command can reach it now. */
function commandable(id: string): Entry {
  if (!client || !isConnected()) {
    throw unavailable();
  }
  const entry = entries.get(id);
  if (!entry) {
    throw notAnnounced();
  }
  if (!onlineOf(entry)) {
    throw new ApiError('device_offline', 'The appliance is not connected to rethink.');
  }
  return entry;
}

/** Publishes, then resolves once `done()` holds for what the appliance reports; throws if not within `confirmMs`. */
function publishAndConfirm(id: string, topic: string, payload: string, done: () => boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new ApiError('device_unreachable', 'The appliance did not confirm the change.')),
      config.rethink.confirmMs,
    );
    function finish(error?: ApiError) {
      clearTimeout(timer);
      applianceEvents.off('change', check);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    function check(changed: string) {
      if (changed === id && done()) {
        finish();
      }
    }
    applianceEvents.on('change', check);
    if (!client?.publish(topic, payload)) {
      finish(unavailable());
    }
  });
}

/** Resolves once the appliance reports the new state; throws if it does not within `confirmMs`. */
export async function setAppliancePower(id: string, power: 'on' | 'off'): Promise<void> {
  const entry = commandable(id);
  if (currentPower(entry) === power) {
    return;
  }
  await publishAndConfirm(id, entry.powerCommandTopic, power === 'on' ? 'ON' : 'OFF', () => currentPower(entry) === power);
}

/** The payload that sets `setting` to `value`; bad_request for anything it does not take. */
function payloadFor(setting: Control, value: unknown): string {
  switch (setting.kind) {
    case 'switch':
      if (typeof value !== 'boolean') {
        throw new ApiError('bad_request', `${setting.name} takes true or false.`);
      }
      return value ? setting.payloadOn : setting.payloadOff;
    case 'select':
      if (typeof value !== 'string' || !setting.options?.includes(value)) {
        throw new ApiError('bad_request', `${setting.name} must be one of: ${setting.options?.join(', ')}.`);
      }
      return value;
    case 'number': {
      const steps = typeof value === 'number' ? (value - setting.min) / setting.step : NaN;
      if (
        typeof value !== 'number' ||
        value < setting.min ||
        value > setting.max ||
        !(Math.abs(steps - Math.round(steps)) < 1e-6)
      ) {
        throw new ApiError(
          'bad_request',
          `${setting.name} must be from ${setting.min} to ${setting.max} in steps of ${setting.step}.`,
        );
      }
      return String(value);
    }
    case 'button':
      return setting.payloadPress;
    default:
      throw new ApiError('bad_request', `${setting.name} can only be read.`);
  }
}

/** Whether the appliance already reports `payload` for `setting`. */
function reports(setting: Control, payload: string): boolean {
  const reported = setting.stateTopic ? values.get(setting.stateTopic) : undefined;
  if (reported === undefined) {
    return false;
  }
  return setting.kind === 'number' ? Number(reported) === Number(payload) : reported === payload;
}

/**
 * Changes one setting (`key` as applianceControls lists it). Resolves once the
 * appliance reports the new value, or, for a button or a setting it does not
 * echo, once rethink has it; throws if the appliance does not confirm.
 */
export async function setApplianceControl(id: string, key: string, value: unknown): Promise<void> {
  const entry = commandable(id);
  const setting = entry.controls.find((candidate) => candidate.key === key);
  if (!setting?.commandTopic) {
    throw new ApiError('bad_request', `This appliance has no setting "${key}".`);
  }
  const payload = payloadFor(setting, value);
  if (!availableOf(entry, setting, currentPower(entry))) {
    const { requires } = attributesOf(setting);
    throw new ApiError(
      'not_controllable',
      setting.needsPower
        ? 'Turn the AC on first.'
        : requires
          ? `${setting.name} needs: ${requires}.`
          : `${setting.name} is not available right now.`,
    );
  }
  if (setting.kind !== 'button' && reports(setting, payload)) {
    return;
  }
  if (setting.kind === 'button' || setting.optimistic || !setting.stateTopic) {
    if (!client?.publish(setting.commandTopic, payload)) {
      throw unavailable();
    }
    if (setting.stateTopic && setting.kind !== 'button') {
      // Assumed until the appliance says otherwise, as Home Assistant does.
      values.set(setting.stateTopic, payload);
      applianceEvents.emit('change', id);
    }
    return;
  }
  await publishAndConfirm(id, setting.commandTopic, payload, () => reports(setting, payload));
}
