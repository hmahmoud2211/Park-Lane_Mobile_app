import type { DirectPairing } from '../../../types/home.types';

/**
 * Setting up a Tasmota plug from its own setup hotspot (`tasmota-…`), through
 * the command URL its web page uses: /cm?cmnd=…
 * (https://tasmota.github.io/docs/Commands/#with-web-requests).
 *
 * The resident joins the plug's hotspot in the phone's settings first; the
 * plug is then at 192.168.4.1. One Backlog gives it the backend's MQTT login
 * and then the home Wi-Fi, last, because joining Wi-Fi restarts it. After
 * that the plug connects to the backend by itself, from any network.
 *
 * Plain HTTP to a local address, which app.json allows (usesCleartextTraffic
 * on Android, NSAllowsLocalNetworking on iOS). Browsers block it, so the web
 * build cannot set up plugs.
 */

export const TASMOTA_AP_URL = 'http://192.168.4.1';
const PROBE_TIMEOUT_MS = 5_000;
const CONFIGURE_TIMEOUT_MS = 8_000;

export interface TasmotaInfo {
  deviceName: string | null;
  /** e.g. `14.3.0(tasmota-tls)`. */
  firmware: string | null;
  mac: string | null;
  /** The firmware's build name mentions TLS, which a backend port with TLS needs. */
  tlsBuild: boolean;
}

export type TasmotaSetupErrorCode = 'not_reached' | 'not_tasmota' | 'password';

export class TasmotaSetupError extends Error {
  readonly code: TasmotaSetupErrorCode;

  constructor(code: TasmotaSetupErrorCode) {
    super(code);
    this.name = 'TasmotaSetupError';
    this.code = code;
  }
}

const commandUrl = (command: string) => `${TASMOTA_AP_URL}/cm?cmnd=${encodeURIComponent(command)}`;

async function request(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } finally {
    clearTimeout(timer);
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const textOf = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** A plug with a web password answers every command with this warning instead. */
const needsPassword = (body: Record<string, unknown> | null) => typeof body?.WARNING === 'string' && /password/i.test(body.WARNING);

/** Checks the phone has reached a Tasmota plug on its hotspot, and reads what it is. */
export async function probePlug(): Promise<TasmotaInfo> {
  let body: Record<string, unknown> | null;
  try {
    body = await request(commandUrl('Status 0'), PROBE_TIMEOUT_MS);
  } catch {
    throw new TasmotaSetupError('not_reached');
  }
  if (needsPassword(body)) {
    throw new TasmotaSetupError('password');
  }
  if (!body || (!body.Status && !body.StatusFWR)) {
    throw new TasmotaSetupError('not_tasmota');
  }
  const firmware = textOf(record(body.StatusFWR).Version);
  return {
    deviceName: textOf(record(body.Status).DeviceName),
    firmware,
    mac: textOf(record(body.StatusNET).Mac),
    tlsBuild: firmware !== null && /tls/i.test(firmware),
  };
}

export interface HomeWifi {
  ssid: string;
  password: string;
}

/** Why the plug could not take this Wi-Fi, or null. Backlog splits on ";" and Tasmota caps the lengths. */
export function wifiProblem({ ssid, password }: HomeWifi): 'missing' | 'too_long' | 'semicolon' | null {
  if (!ssid.trim()) return 'missing';
  if (ssid.length > 32 || password.length > 64) return 'too_long';
  if (ssid.includes(';') || password.includes(';')) return 'semicolon';
  return null;
}

/** The plug's whole setup as one Backlog, Wi-Fi last. */
export function setupBacklog(pairing: DirectPairing, wifi: HomeWifi): string {
  const { mqtt } = pairing;
  return [
    `MqttHost ${mqtt.host}`,
    `MqttPort ${mqtt.port}`,
    `MqttUser ${mqtt.username}`,
    `MqttPassword ${mqtt.password}`,
    `Topic ${mqtt.topic}`,
    'FullTopic %prefix%/%topic%/',
    // TLS on a tasmota-tls build, which checks the server's certificate against the CAs built into it.
    `SetOption103 ${mqtt.tls ? 1 : 0}`,
    `SSID1 ${wifi.ssid.trim()}`,
    // An open network keeps the empty password a reset plug starts with.
    ...(wifi.password ? [`Password1 ${wifi.password}`] : []),
  ].join('; ');
}

/**
 * Sends the setup to the plug. It restarts as it takes the Wi-Fi settings and
 * may drop the answer, so no answer still counts as sent; whether it worked
 * shows when the plug connects to the backend.
 */
export async function configurePlug(pairing: DirectPairing, wifi: HomeWifi): Promise<void> {
  let body: Record<string, unknown> | null = null;
  try {
    body = await request(commandUrl(`Backlog ${setupBacklog(pairing, wifi)}`), CONFIGURE_TIMEOUT_MS);
  } catch {
    return;
  }
  if (needsPassword(body)) {
    throw new TasmotaSetupError('password');
  }
}
