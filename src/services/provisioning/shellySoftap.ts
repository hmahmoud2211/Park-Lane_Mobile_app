import { DeviceHttpError, deviceRequest } from './deviceHttp';

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

export const SHELLY_SETUP_IP = '192.168.33.1';
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
