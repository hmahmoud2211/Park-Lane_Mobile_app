import * as Network from 'expo-network';
import { Platform } from 'react-native';

import { gatewayBaseUrl, gatewayConfig } from '../../../config/gateway';
import type { GatewayHealth } from '../../../types/gateway.types';
import { challenge, getHealth } from './gatewayApi';
import { GatewayError } from './gatewayHttp';
import type { StoredGateway } from './gatewayStore.types';
import { identityProof, newNonce, sameProof } from './hmac';

/**
 * Finding gateways and choosing which address to use.
 *
 * The gateway also advertises itself over mDNS (_cube-gw._tcp), but React
 * Native has no mDNS without an extra native module, so the app finds it by
 * asking every address in the phone's own /24 for GET /api/v1/health. It only
 * ever probes private addresses. An answer is never trusted on its own: a
 * paired gateway must prove its identity (hmac.ts) before the phone sends its
 * token to an address it has not verified before.
 */

export interface FoundGateway {
  baseUrl: string;
  health: GatewayHealth;
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The phone's own private IPv4 address, or null (not on Wi-Fi, web, or a public address). */
export async function localAddress(): Promise<string | null> {
  if (Platform.OS === 'web') {
    // expo-network reports the public address on the web, which must never be scanned.
    return null;
  }
  const ip = await Network.getIpAddressAsync().catch(() => '0.0.0.0');
  return isPrivateIPv4(ip) ? ip : null;
}

/**
 * Probes the phone's /24 for gateways, a batch at a time. Calls `onFound` as
 * each answers; resolves with all of them once the sweep ends or `signal`
 * aborts.
 */
export async function scanLan(options: {
  signal?: AbortSignal;
  onFound?: (found: FoundGateway) => void;
  onProgress?: (fraction: number) => void;
}): Promise<FoundGateway[]> {
  const ip = await localAddress();
  if (!ip) {
    throw new GatewayError(
      'no_local_network',
      'This phone is not on a home Wi-Fi network the app can scan.',
      'Join your home Wi-Fi, or enter the gateway’s address yourself.',
    );
  }
  const prefix = ip.split('.').slice(0, 3).join('.');
  const hosts = Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);
  const found: FoundGateway[] = [];

  for (let start = 0; start < hosts.length; start += gatewayConfig.scanBatchSize) {
    if (options.signal?.aborted) {
      break;
    }
    const batch = hosts.slice(start, start + gatewayConfig.scanBatchSize);
    await Promise.all(
      batch.map(async (host) => {
        const baseUrl = `http://${host}:${gatewayConfig.defaultPort}`;
        try {
          const health = await getHealth(baseUrl, gatewayConfig.scanProbeTimeoutMs, options.signal);
          if (health && typeof health.gateway_id === 'string') {
            const entry = { baseUrl, health };
            found.push(entry);
            options.onFound?.(entry);
          }
        } catch {
          // Nothing there, or not a gateway.
        }
      }),
    );
    options.onProgress?.(Math.min(1, (start + batch.length) / hosts.length));
  }
  return found;
}

/** Asks the address to prove it is the paired gateway. Never sends the token. */
export async function verifyGateway(baseUrl: string, gateway: Pick<StoredGateway, 'id' | 'clientId' | 'pinKey'>): Promise<boolean> {
  const nonce = newNonce();
  try {
    const answer = await challenge(baseUrl, gateway.clientId, nonce);
    if (answer.gateway_id !== gateway.id) {
      return false;
    }
    const expected = await identityProof(gateway.pinKey, gateway.id, nonce);
    return sameProof(expected, answer.proof.toLowerCase());
  } catch {
    return false;
  }
}

export interface ResolvedEndpoint {
  url: string;
  /** False when the address was verified on an earlier visit. */
  newlyVerified: boolean;
  /** The gateway's home address changed and was found by scanning. */
  lanChanged: boolean;
}

/**
 * The address to use for a paired gateway: the last one that worked, its home
 * address, its remote addresses, then a scan of the home network for the same
 * gateway id (its IP may have changed). Each must answer with the right id,
 * and an address not seen before must also pass the identity proof.
 */
export async function resolveEndpoint(gateway: StoredGateway, options: { signal?: AbortSignal; scan?: boolean } = {}): Promise<ResolvedEndpoint | null> {
  const known = [gateway.lastUrl, gateway.endpoints.lan, ...(gateway.endpoints.remote ?? [])].filter(
    (url, index, all): url is string => Boolean(url) && all.indexOf(url) === index,
  );

  const accept = async (url: string, lanChanged: boolean): Promise<ResolvedEndpoint | null> => {
    if (gateway.verifiedUrls.includes(url)) {
      return { url, newlyVerified: false, lanChanged };
    }
    return (await verifyGateway(url, gateway)) ? { url, newlyVerified: true, lanChanged } : null;
  };

  for (const url of known) {
    if (options.signal?.aborted) {
      return null;
    }
    try {
      const health = await getHealth(url, gatewayConfig.healthTimeoutMs, options.signal);
      if (health.gateway_id === gateway.id) {
        const accepted = await accept(url, false);
        if (accepted) {
          return accepted;
        }
      }
    } catch {
      // Try the next address.
    }
  }

  // A gateway on CUBE's server has no home address: there is nothing on the Wi-Fi to look for.
  if (options.scan === false || !gateway.endpoints.lan) {
    return null;
  }
  const found = await scanLan({ signal: options.signal }).catch(() => [] as FoundGateway[]);
  for (const entry of found) {
    if (entry.health.gateway_id === gateway.id) {
      const accepted = await accept(entry.baseUrl, true);
      if (accepted) {
        return accepted;
      }
    }
  }
  return null;
}

export interface PairPayload {
  baseUrl: string;
  gatewayId: string | null;
  code: string | null;
  /** The gateway runs on CUBE's server and is reached through the relay, not the home Wi-Fi. */
  remote: boolean;
}

/** An https address the app may use for a gateway on CUBE's server, e.g. https://cube-relay.ems-iot.com/relay/v1/g/<id>. */
export function isRemoteGatewayUrl(value: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\-/]*)?$/.test(value.trim());
}

/**
 * Reads a pairing code. Home gateways print cubegw://pair?host=<ip:port>&id=<gateway_id>&code=<setup_code> in
 * their logs; a gateway on CUBE's server comes as cubegw://pair?url=<https base>&id=<gateway_id>&code=<setup_code>.
 */
export function parsePairPayload(data: string): PairPayload | null {
  const text = data.trim();
  if (!text.toLowerCase().startsWith(gatewayConfig.pairScheme)) {
    return null;
  }
  const query = text.split('?')[1] ?? '';
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) {
      try {
        params.set(decodeURIComponent(key), decodeURIComponent(value));
      } catch {
        return null;
      }
    }
  }
  const gatewayId = params.get('id') ?? null;
  const code = params.get('code') ?? null;
  const url = params.get('url');
  if (url) {
    return isRemoteGatewayUrl(url) ? { baseUrl: gatewayBaseUrl(url), gatewayId, code, remote: true } : null;
  }
  const host = params.get('host');
  if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) {
    return null;
  }
  return { baseUrl: gatewayBaseUrl(host), gatewayId, code, remote: false };
}
