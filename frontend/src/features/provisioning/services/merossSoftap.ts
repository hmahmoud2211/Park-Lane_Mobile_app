import * as Crypto from 'expo-crypto';

import { vendorDevices } from '../../../config/vendorDevices';
import { timedFetch } from '../../../lib/http/request';
import { DeviceHttpError } from './deviceHttp';
import {
  decrypt,
  devicePrivateKey,
  encrypt,
  encryptWifiPassword,
  fromBase64,
  publicKeyOf,
  sharedSessionKey,
  sign,
  toBase64,
  utf8ToBytes,
} from './merossCrypto';

/**
 * Sets up a Meross device on its own open Wi-Fi network (the gateway's
 * meross_cloud_softap plugin): the phone gives it the home Wi-Fi and the address
 * of CUBE's server, so it needs no Meross account and no box at home.
 *
 * Every request is an HTTP POST of a signed JSON message to /config; newer
 * firmware first runs a key exchange and then encrypts each one. See
 * bytespider/Meross (the same setup as a command line tool, ISC licensed).
 *
 * Nothing here logs: messages carry the home Wi-Fi password.
 */

const SETUP_IP = vendorDevices.merossSetupIp;
const DETECT_TIMEOUT_MS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;
/** The device scans for networks while it answers this one. */
const WIFI_LIST_TIMEOUT_MS = 15_000;

const NS = {
  all: 'Appliance.System.All',
  ability: 'Appliance.System.Ability',
  time: 'Appliance.System.Time',
  ecdhe: 'Appliance.Encrypt.ECDHE',
  key: 'Appliance.Config.Key',
  wifi: 'Appliance.Config.Wifi',
  wifiX: 'Appliance.Config.WifiX',
  wifiList: 'Appliance.Config.WifiList',
} as const;

const UUID = /^[0-9a-f]{32}$/;
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;

export interface MerossIdentity {
  uuid: string;
  /** As the device spells it: its login to CUBE's server is derived from this exact text. */
  mac: string;
  model: string;
  abilities: string[];
}

export interface MerossLogin {
  host: string;
  port: number;
  key: string;
  userId: string;
}

/** Reads what the gateway prepared from a provisioning session's `setup`; null when anything is missing. */
export function merossLoginFrom(setup: Record<string, string> | undefined): MerossLogin | null {
  const [host, port] = (setup?.mqtt_server ?? '').split(':');
  const key = setup?.meross_key ?? '';
  const userId = setup?.meross_user_id ?? '';
  return host && Number(port) > 0 && key && userId ? { host, port: Number(port), key, userId } : null;
}

class MerossRefused extends Error {}

interface Connection {
  url: string;
  key: string;
  /** Set once the key exchange has run; from then on messages are encrypted. */
  sessionKey: Uint8Array | null;
}

type Payload = Record<string, unknown>;

async function call(
  connection: Connection,
  namespace: string,
  method: 'GET' | 'SET',
  payload: Payload,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Payload> {
  const messageId = Crypto.randomUUID().replace(/-/g, '');
  const timestamp = Math.round(Date.now() / 1000);
  const body = JSON.stringify({
    header: { from: connection.url, messageId, method, namespace, payloadVersion: 1, sign: sign(messageId, connection.key, timestamp), timestamp },
    payload,
  });
  const { sessionKey } = connection;
  const contentType = sessionKey ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
  const text = await timedFetch(connection.url, {
    init: {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: sessionKey ? 'text/plain' : 'application/json' },
      body: sessionKey ? toBase64(encrypt(utf8ToBytes(body), sessionKey)) : body,
    },
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    signal: options.signal,
    noAnswer: ({ timedOut, aborted }) => {
      if (aborted) {
        return new DeviceHttpError('aborted', 'Stopped.');
      }
      return timedOut ? new DeviceHttpError('timeout', 'The device did not answer in time.') : new DeviceHttpError('unreachable', 'Could not reach the device on its setup network.');
    },
    read: async (response) => {
      if (!response.ok) {
        throw new DeviceHttpError('httpError', `The device answered ${response.status}.`, response.status);
      }
      return response.text();
    },
  });
  let parsed: { header?: { method?: string }; payload?: Payload; error?: unknown };
  try {
    parsed = JSON.parse(sessionKey ? new TextDecoder().decode(decrypt(fromBase64(text.trim()), sessionKey)) : text) as typeof parsed;
  } catch {
    throw new DeviceHttpError('invalidResponse', 'The device’s answer could not be read.');
  }
  const answer = parsed.payload ?? {};
  if (parsed.error || answer.error || parsed.header?.method !== `${method}ACK`) {
    throw new MerossRefused(`The device refused ${namespace}.`);
  }
  return answer;
}

function connectionFor(ip: string, key: string): Connection {
  return { url: `http://${ip}/config`, key, sessionKey: null };
}

/** Who is on the setup network. Null when it is not a Meross device. */
export async function detectMeross(ip: string = SETUP_IP, key: string = '', signal?: AbortSignal): Promise<MerossIdentity | null> {
  const connection = connectionFor(ip, key);
  try {
    const all = (await call(connection, NS.all, 'GET', {}, { timeoutMs: DETECT_TIMEOUT_MS, signal })).all as
      | { system?: { hardware?: { uuid?: unknown; macAddress?: unknown; type?: unknown } } }
      | undefined;
    const hardware = all?.system?.hardware;
    const uuid = typeof hardware?.uuid === 'string' ? hardware.uuid : '';
    const mac = typeof hardware?.macAddress === 'string' ? hardware.macAddress : '';
    const model = typeof hardware?.type === 'string' ? hardware.type : '';
    if (!UUID.test(uuid) || !MAC.test(mac) || !model) {
      return null;
    }
    const ability = (await call(connection, NS.ability, 'GET', {}, { timeoutMs: DETECT_TIMEOUT_MS, signal })).ability;
    return { uuid, mac, model, abilities: ability && typeof ability === 'object' ? Object.keys(ability) : [] };
  } catch {
    return null;
  }
}

export type MerossSetupStep = 'encryption' | 'server' | 'wifi';

export type MerossSetupOutcome =
  /** The device confirmed the Wi-Fi. */
  | { kind: 'accepted' }
  /** No answer to the Wi-Fi step: the device may have restarted while answering. Only seeing it connect tells. */
  | { kind: 'noResponse' }
  | { kind: 'rejected'; step: MerossSetupStep; message: string };

interface WifiEntry {
  ssid?: string;
  bssid?: string;
  channel?: number;
  encryption?: number;
  cipher?: number;
}

/** The chosen network as the device sees it. Firmware takes these; without them it works out what it can. */
async function nearbyNetwork(connection: Connection, ssid: string, signal?: AbortSignal): Promise<WifiEntry | null> {
  const wanted = toBase64(utf8ToBytes(ssid));
  try {
    const { wifiList } = await call(connection, NS.wifiList, 'GET', { trace: {} }, { timeoutMs: WIFI_LIST_TIMEOUT_MS, signal });
    return Array.isArray(wifiList) ? ((wifiList as WifiEntry[]).find((entry) => entry.ssid === wanted) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The setup, in the order the bytespider tool runs it:
 *
 * 1. Key exchange, when the firmware has Appliance.Encrypt.ECDHE.
 * 2. The clock, so the device can check certificate dates (best effort).
 * 3. Appliance.Config.Key: the broker's address, the signing key and the user id.
 * 4. Appliance.Config.Wifi or WifiX: the home Wi-Fi. The device then restarts.
 */
export async function sendSetupToMeross(
  identity: MerossIdentity,
  wifi: { ssid: string; password: string },
  login: MerossLogin,
  options: { ip?: string; signal?: AbortSignal } = {},
): Promise<MerossSetupOutcome> {
  const connection = connectionFor(options.ip ?? SETUP_IP, login.key);
  const { signal } = options;
  let step: MerossSetupStep = 'encryption';
  try {
    if (identity.abilities.includes(NS.ecdhe)) {
      const privateKey = devicePrivateKey(identity.uuid, login.key, identity.mac);
      const { ecdhe } = await call(connection, NS.ecdhe, 'SET', { ecdhe: { step: 1, pubkey: toBase64(publicKeyOf(privateKey)) } }, { signal });
      const remote = (ecdhe as { pubkey?: unknown } | undefined)?.pubkey;
      if (typeof remote !== 'string') {
        return { kind: 'rejected', step, message: 'The device did not complete the key exchange.' };
      }
      connection.sessionKey = sharedSessionKey(privateKey, fromBase64(remote));
    }

    await call(connection, NS.time, 'SET', { time: { timestamp: Math.round(Date.now() / 1000), timezone: 'Etc/UTC' } }, { signal }).catch((error: unknown) => {
      if (error instanceof DeviceHttpError && error.kind === 'aborted') {
        throw error;
      }
    });

    step = 'server';
    await call(
      connection,
      NS.key,
      'SET',
      {
        key: {
          userId: login.userId,
          key: login.key,
          gateway: { host: login.host, port: login.port, secondHost: login.host, secondPort: login.port, redirect: 1 },
        },
      },
      { signal },
    );

    step = 'wifi';
    const usesWifiX = identity.abilities.includes(NS.wifiX);
    const nearby = await nearbyNetwork(connection, wifi.ssid, signal);
    const password = wifi.password
      ? usesWifiX
        ? toBase64(encryptWifiPassword(wifi.password, { type: identity.model, uuid: identity.uuid, mac: identity.mac }))
        : toBase64(utf8ToBytes(wifi.password))
      : '';
    await call(connection, usesWifiX ? NS.wifiX : NS.wifi, 'SET', { wifi: { ...nearby, ssid: toBase64(utf8ToBytes(wifi.ssid)), password } }, { signal });
    return { kind: 'accepted' };
  } catch (error) {
    if (error instanceof DeviceHttpError && error.kind === 'aborted') {
      throw error;
    }
    if (error instanceof MerossRefused || (error instanceof DeviceHttpError && error.kind === 'httpError')) {
      return { kind: 'rejected', step, message: error.message };
    }
    if (step !== 'wifi') {
      return { kind: 'rejected', step, message: 'The device stopped answering on its setup network.' };
    }
    return { kind: 'noResponse' };
  }
}
