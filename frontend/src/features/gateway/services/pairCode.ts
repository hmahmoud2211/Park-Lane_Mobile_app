import { gatewayBaseUrl, gatewayConfig } from '../../../config/gateway';

export interface PairPayload {
  /** Null when the code doesn't say where a phone finds the gateway: the resident types the address. */
  baseUrl: string | null;
  gatewayId: string | null;
  code: string | null;
  /** The gateway runs on CUBE's server and is reached through the relay, not the home Wi-Fi. */
  remote: boolean;
}

/** An https address the app may use for a gateway on CUBE's server, e.g. https://cube-relay.ems-iot.com/relay/v1/g/<id>. */
export function isRemoteGatewayUrl(value: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\-/]*)?$/.test(value.trim());
}

/** Addresses that mean the phone itself. Gateways on CUBE's server printed one before they named the relay. */
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?$/i;

/**
 * Reads a gateway's pairing QR code:
 * - at home, cubegw://pair?host=<ip:port>&id=<gateway_id>&code=<setup_code>
 * - on CUBE's server, cubegw://pair?url=<https base>&id=<gateway_id>&code=<setup_code>
 * - from a gateway that can't tell its own address, no host at all, so the code is still used.
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
  if (!host || LOOPBACK.test(host)) {
    return code ? { baseUrl: null, gatewayId, code, remote: false } : null;
  }
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(host)) {
    return null;
  }
  return { baseUrl: gatewayBaseUrl(host), gatewayId, code, remote: false };
}
