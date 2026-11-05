import { DeviceHttpError, deviceRequest } from './deviceHttp';
import { vendorDevices } from '../../../config/vendorDevices';

/**
 * Sends the home Wi-Fi to a Shelly on its own setup network, with Shelly's
 * documented local API (the gateway's shelly_softap plugin):
 *
 * - Gen1: GET /settings/sta?enabled=1&ssid=…&key=…
 *   https://shelly-api-docs.shelly.cloud/gen1/#settings-sta
 * - Gen2+: POST /rpc { method: "WiFi.SetConfig", params: { config: { sta: { ssid, pass, enable: true } } } }
 *   https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/WiFi
 *
 * The password goes from the phone to the Shelly only. It is never logged,
 * stored or sent to the gateway.
 */

const SHELLY_SETUP_IP = vendorDevices.shellySetupIp;
const DETECT_TIMEOUT_MS = 3_000;
const SEND_TIMEOUT_MS = 8_000;

export interface ShellyIdentity {
  gen: number;
  mac: string;
  model: string | null;
  /** Gen2+ device id, e.g. shellyplus1-a8032ab12345. */
  id: string | null;
}

/** GET /shelly: who is on the setup network. Null when it is not a Shelly. */
export async function detectShelly(ip: string = SHELLY_SETUP_IP, signal?: AbortSignal): Promise<ShellyIdentity | null> {
  try {
    const body = (await deviceRequest(`http://${ip}/shelly`, { timeoutMs: DETECT_TIMEOUT_MS, signal })) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || typeof body.mac !== 'string') {
      return null;
    }
    const gen = typeof body.gen === 'number' ? body.gen : 1;
    if (gen === 1 && typeof body.type !== 'string') {
      return null;
    }
    return {
      gen,
      mac: body.mac.toLowerCase(),
      model: typeof body.model === 'string' ? body.model : typeof body.type === 'string' ? body.type : null,
      id: typeof body.id === 'string' ? body.id : null,
    };
  } catch {
    return null;
  }
}

export type ShellySendOutcome =
  /** The Shelly confirmed it stored the settings. */
  | { kind: 'accepted' }
  /** No answer: the Shelly may have switched networks while answering. Only finding it on the LAN tells. */
  | { kind: 'noResponse' }
  | { kind: 'rejected'; message: string };

export async function sendWifiToShelly(
  shelly: ShellyIdentity,
  wifi: { ssid: string; password: string },
  options: { ip?: string; signal?: AbortSignal } = {},
): Promise<ShellySendOutcome> {
  const ip = options.ip ?? SHELLY_SETUP_IP;
  try {
    if (shelly.gen >= 2) {
      const body = (await deviceRequest(`http://${ip}/rpc`, {
        method: 'POST',
        body: { id: 1, method: 'WiFi.SetConfig', params: { config: { sta: { ssid: wifi.ssid, pass: wifi.password, enable: true } } } },
        timeoutMs: SEND_TIMEOUT_MS,
        signal: options.signal,
      })) as { result?: unknown; error?: { message?: string } };
      if (body && typeof body === 'object' && 'error' in body && body.error) {
        return { kind: 'rejected', message: body.error.message ?? 'The Shelly refused the Wi-Fi settings.' };
      }
      return { kind: 'accepted' };
    }
    const query = `enabled=1&ssid=${encodeURIComponent(wifi.ssid)}&key=${encodeURIComponent(wifi.password)}`;
    const body = (await deviceRequest(`http://${ip}/settings/sta?${query}`, { timeoutMs: SEND_TIMEOUT_MS, signal: options.signal })) as {
      ssid?: unknown;
    };
    return body && typeof body === 'object' && body.ssid === wifi.ssid
      ? { kind: 'accepted' }
      : { kind: 'rejected', message: 'The Shelly did not keep the network name.' };
  } catch (error) {
    if (error instanceof DeviceHttpError && error.kind === 'httpError') {
      return { kind: 'rejected', message: error.message };
    }
    if (error instanceof DeviceHttpError && error.kind === 'aborted') {
      throw error;
    }
    return { kind: 'noResponse' };
  }
}

// ---- Shelly connecting to CUBE's server (the gateway's shelly_cloud_softap plugin) ----------------

/**
 * What the gateway hands the phone for a Shelly that will connect to CUBE's
 * device broker instead of the home network (session.setup). The password is
 * the device's own broker login: it goes phone → Shelly only and is never
 * logged or stored.
 */
export interface ShellyCloudLogin {
  server: string;
  user: string;
  password: string;
  clientId: string;
  topicPrefix: string;
  caPem: string;
}

/** Reads the login from a provisioning session's `setup`; null when anything is missing. */
export function cloudLoginFrom(setup: Record<string, string> | undefined): ShellyCloudLogin | null {
  const server = setup?.mqtt_server ?? '';
  const user = setup?.mqtt_user ?? '';
  const password = setup?.mqtt_password ?? '';
  const topicPrefix = setup?.mqtt_topic_prefix ?? '';
  const caPem = setup?.mqtt_ca_pem ?? '';
  if (!server || !user || !password || !topicPrefix || !caPem.includes('BEGIN CERTIFICATE')) {
    return null;
  }
  return { server, user, password, clientId: setup?.mqtt_client_id || user, topicPrefix, caPem };
}

/** Shelly.PutUserCA takes the PEM in pieces; a few lines at a time stays well inside one RPC frame. */
const CA_CHUNK_CHARS = 900;

export function pemChunks(pem: string, size: number = CA_CHUNK_CHARS): string[] {
  const lines = pem.replace(/\r\n/g, '\n').trim().split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const next = `${line}\n`;
    if (current && current.length + next.length > size) {
      chunks.push(current);
      current = '';
    }
    current += next;
  }
  if (current) chunks.push(current);
  return chunks;
}

class ShellyRpcError extends Error {}

async function shellyRpc(ip: string, id: number, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const body = (await deviceRequest(`http://${ip}/rpc`, {
    method: 'POST',
    body: { id, method, params },
    timeoutMs: SEND_TIMEOUT_MS,
    signal,
  })) as { result?: unknown; error?: { message?: string } } | null;
  if (body && typeof body === 'object' && 'error' in body && body.error) {
    throw new ShellyRpcError(body.error.message ?? `The Shelly refused ${method}.`);
  }
  return body && typeof body === 'object' ? body.result : undefined;
}

export type ShellyCloudOutcome =
  /** Certificate, broker login and Wi-Fi stored, and the restart accepted. */
  | { kind: 'accepted' }
  /** Settings stored, but the Wi-Fi change or restart got no answer (the Shelly may have switched networks). */
  | { kind: 'noResponse'; restartUnconfirmed: boolean }
  | { kind: 'rejected'; step: 'certificate' | 'mqtt' | 'wifi'; message: string }
  /** Gen1 Shelly devices only speak unencrypted MQTT. */
  | { kind: 'unsupported' };

/**
 * Prepares a Gen2+ Shelly, on its own setup network, to connect to CUBE's
 * server, with Shelly's documented RPCs:
 *
 * 1. Shelly.PutUserCA: the CA that signed the broker's certificate, in chunks
 *    (append: true for all but the last).
 * 2. Mqtt.SetConfig: the broker, the device's own login and topic prefix, TLS
 *    verified with that CA (ssl_ca: user_ca.pem).
 * 3. WiFi.SetConfig: the home Wi-Fi.
 * 4. Shelly.Reboot: MQTT settings apply after a restart.
 *
 * https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt and /Shelly
 */
export async function sendCloudSetupToShelly(
  shelly: ShellyIdentity,
  wifi: { ssid: string; password: string },
  login: ShellyCloudLogin,
  options: { ip?: string; signal?: AbortSignal } = {},
): Promise<ShellyCloudOutcome> {
  if (shelly.gen < 2) {
    return { kind: 'unsupported' };
  }
  const ip = options.ip ?? SHELLY_SETUP_IP;
  let id = 1;
  let step: 'certificate' | 'mqtt' | 'wifi' = 'certificate';
  try {
    const chunks = pemChunks(login.caPem);
    for (let index = 0; index < chunks.length; index += 1) {
      await shellyRpc(ip, id++, 'Shelly.PutUserCA', { data: chunks[index], append: index < chunks.length - 1 }, options.signal);
    }
    step = 'mqtt';
    await shellyRpc(
      ip,
      id++,
      'Mqtt.SetConfig',
      {
        config: {
          enable: true,
          server: login.server,
          client_id: login.clientId,
          user: login.user,
          pass: login.password,
          ssl_ca: 'user_ca.pem',
          topic_prefix: login.topicPrefix,
          rpc_ntf: true,
          status_ntf: false,
          enable_control: true,
        },
      },
      options.signal,
    );
    step = 'wifi';
    await shellyRpc(ip, id++, 'WiFi.SetConfig', { config: { sta: { ssid: wifi.ssid, pass: wifi.password, enable: true } } }, options.signal);
  } catch (error) {
    if (error instanceof DeviceHttpError && error.kind === 'aborted') {
      throw error;
    }
    if (error instanceof ShellyRpcError || (error instanceof DeviceHttpError && error.kind === 'httpError')) {
      return { kind: 'rejected', step, message: error.message };
    }
    if (step !== 'wifi') {
      return { kind: 'rejected', step, message: 'The Shelly stopped answering on its setup network.' };
    }
    // Storing the Wi-Fi can drop the setup network mid-answer; try the restart anyway.
  }
  try {
    await shellyRpc(ip, id++, 'Shelly.Reboot', { delay_ms: 1000 }, options.signal);
    return { kind: 'accepted' };
  } catch (error) {
    if (error instanceof DeviceHttpError && error.kind === 'aborted') {
      throw error;
    }
    return { kind: 'noResponse', restartUnconfirmed: true };
  }
}
