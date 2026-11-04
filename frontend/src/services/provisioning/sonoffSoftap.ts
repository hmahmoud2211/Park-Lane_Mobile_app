import { deviceRequest } from './deviceHttp';

/**
 * Talks to a SONOFF on its ITEAD- setup network (Compatible Pairing Mode).
 * Only `GET /device` is used: it answers on DIY-capable devices and was
 * confirmed on the S26R2TPF in this project's earlier testing. It returns
 * `{ deviceid, apikey, accept, chipid }`; per AlexxIT/SonoffLAN the apikey is
 * the device key that eWeLink LAN mode encrypts with, so the app hands it to
 * the gateway session (sealed there) in case the device ends up in eWeLink
 * mode rather than DIY mode. The Wi-Fi itself is entered on the device's own
 * page (setupPage.ts), as ITEAD documents for DIY mode.
 *
 * Nothing here logs; the apikey never appears in an error.
 */

export const SONOFF_SETUP_IP = '10.10.7.1';
const DETECT_TIMEOUT_MS = 4_000;

/** Device ids are 10 hex digits on every eWeLink Wi-Fi device seen so far. */
const DEVICE_ID = /^[0-9a-f]{10}$/i;

export interface SonoffSetupInfo {
  deviceId: string;
  chipId: string | null;
  /** The device key. Secret: sent only to the gateway's provisioning session. */
  apikey: string;
}

function text(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** GET /device on the setup network. Null when nothing there answers like a SONOFF. */
export async function readSonoffDevice(ip: string = SONOFF_SETUP_IP, signal?: AbortSignal): Promise<SonoffSetupInfo | null> {
  let body: unknown;
  try {
    body = await deviceRequest(`http://${ip}/device`, { timeoutMs: DETECT_TIMEOUT_MS, signal });
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const deviceId = text(record, 'deviceid');
  const apikey = text(record, 'apikey');
  // A stray web server on 10.10.7.1 must not be taken for the device.
  if (!deviceId || !DEVICE_ID.test(deviceId) || !apikey) {
    return null;
  }
  return { deviceId: deviceId.toLowerCase(), chipId: text(record, 'chipid'), apikey };
}
