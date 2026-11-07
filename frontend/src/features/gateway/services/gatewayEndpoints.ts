import { gatewayConfig } from '../../../config/gateway';
import type { GatewayHealth } from '../../../types/gateway.types';
import type { StoredGateway } from './gatewayStore.types';

/**
 * Which of a paired gateway's addresses to try, and in what order.
 *
 * A gateway with a certificate reports HTTPS names for itself in its health
 * (`tls.lan_url`, `tls.remote_url`). The certificate is for a name whose first
 * label is the gateway's id, so a server that completes the TLS handshake for
 * that name is that gateway: the app sends its token there without the identity
 * challenge (hmac.ts) its plain-HTTP and relay addresses need. That holds only
 * inside zones the relay issues certificates in (gatewayConfig.tlsZones): anyone
 * can get a certificate for `<id>.their-own-domain`, and the names arrive in
 * health that plain HTTP doesn't protect.
 */

type Endpoints = StoredGateway['endpoints'];

const TLS_BASE_URL = /^https:\/\/([a-z0-9-]+)((?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?\/?$/i;

/**
 * `value` as a base URL when it is `https://<gatewayId>.<zone>[:port]`, with
 * `zone` one of `zones` and no path, query or credentials; anything else is
 * null. Only such a name is one this gateway alone can hold a certificate for.
 */
export function gatewayTlsUrl(value: unknown, gatewayId: string, zones: readonly string[] = gatewayConfig.tlsZones): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = TLS_BASE_URL.exec(value);
  if (!match || match[1].toLowerCase() !== gatewayId.toLowerCase() || !zones.includes(match[2].slice(1).toLowerCase())) {
    return null;
  }
  const port = match[3] === undefined ? null : Number(match[3]);
  if (port !== null && (port < 1 || port > 65_535)) {
    return null;
  }
  // No trailing slash: callers append /api/v1/... to a base URL.
  return `https://${`${match[1]}${match[2]}`.toLowerCase()}${port === null ? '' : `:${port}`}`;
}

/**
 * The endpoints with the HTTPS names from a verified gateway's health. A name
 * it no longer reports (or never did, as on older gateways) is dropped, so the
 * app stops trying it.
 */
export function withTlsEndpoints(endpoints: Endpoints, gatewayId: string, health: GatewayHealth): Endpoints {
  return {
    ...endpoints,
    lanTls: gatewayTlsUrl(health.tls?.lan_url, gatewayId) ?? undefined,
    remoteTls: gatewayTlsUrl(health.tls?.remote_url, gatewayId) ?? undefined,
  };
}

export interface EndpointAttempt {
  url: string;
  /** One of the stored HTTPS names: the right gateway id in its health is enough. */
  tls: boolean;
  timeoutMs: number;
}

/**
 * The last address that worked, the home HTTPS name, the home address, the
 * remote HTTPS name, then the other remote addresses (a scan of the home
 * network comes after these, in gatewayDiscovery.ts).
 */
export function endpointAttempts(gateway: Pick<StoredGateway, 'lastUrl' | 'endpoints'>): EndpointAttempt[] {
  const { lan, lanTls, remote = [], remoteTls } = gateway.endpoints;
  return [gateway.lastUrl, lanTls, lan, remoteTls, ...remote]
    .filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index)
    .map((url) => ({
      url,
      tls: url === lanTls || url === remoteTls,
      timeoutMs: url === lanTls ? gatewayConfig.lanTlsTimeoutMs : gatewayConfig.healthTimeoutMs,
    }));
}
