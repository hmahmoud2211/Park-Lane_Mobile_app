/**
 * Behaviour checks for a paired gateway's addresses: which HTTPS names from its health
 * the app keeps, and the order (and rules) it tries its addresses in.
 *
 *   npm run check:endpoints
 */

import { gatewayConfig } from '../../../config/gateway';
import type { GatewayHealth, GatewayTls } from '../../../types/gateway.types';
import { endpointAttempts, gatewayTlsUrl, withTlsEndpoints, type EndpointAttempt } from './gatewayEndpoints';
import type { StoredGateway } from './gatewayStore.types';

const ID = '0810268a-65a9-4059-a543-0e1daaa8ab51';
const LAN_TLS = `https://${ID}.gw.ems-iot.com:8443`;
const REMOTE_TLS = `https://${ID}.r.ems-iot.com`;
const LAN = 'http://192.168.1.20:8686';
const RELAY = `https://cube-relay.ems-iot.com/relay/v1/g/${ID}`;
const TAILSCALE = 'http://100.64.0.7:8686';

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const refused = (value: unknown) => equal(gatewayTlsUrl(value, ID), null, String(value));

function health(tls?: GatewayTls | null): GatewayHealth {
  return {
    status: 'ok',
    version: '1.0.0',
    api_version: 1,
    gateway_id: ID,
    name: 'Home',
    claimed: true,
    uptime: 1,
    adapters: { loaded: 1, failed: 0 },
    ...(tls === undefined ? {} : { tls }),
  };
}

const tls = (lan_url: string | null, remote_url: string | null): GatewayTls => ({ lan_url, remote_url, expires_at: 1767225600 });

/** What each kind of address is tried with: the home HTTPS name gets the short timeout. */
const plain = (url: string): EndpointAttempt => ({ url, tls: false, timeoutMs: gatewayConfig.healthTimeoutMs });
const lanTls = (url: string): EndpointAttempt => ({ url, tls: true, timeoutMs: gatewayConfig.lanTlsTimeoutMs });
const remoteTls = (url: string): EndpointAttempt => ({ url, tls: true, timeoutMs: gatewayConfig.healthTimeoutMs });

const gateway = (lastUrl: string | null, endpoints: StoredGateway['endpoints']) => ({ lastUrl, endpoints });

const checks: [string, () => void][] = [
  ['a home HTTPS name with its port is kept as reported', () => equal(gatewayTlsUrl(LAN_TLS, ID), LAN_TLS)],
  ['a remote HTTPS name on port 443 is kept as reported', () => equal(gatewayTlsUrl(REMOTE_TLS, ID), REMOTE_TLS)],
  ['a trailing slash is dropped, since paths are appended to it', () => equal(gatewayTlsUrl(`${REMOTE_TLS}/`, ID), REMOTE_TLS)],
  [
    'the id is compared ignoring case, and the name is kept in lower case',
    () => equal(gatewayTlsUrl(`HTTPS://${ID.toUpperCase()}.GW.EMS-IOT.COM:8443`, ID), LAN_TLS),
  ],
  ['plain http is refused', () => refused(`http://${ID}.gw.ems-iot.com:8686`)],
  ['a path is refused', () => refused(`https://${ID}.r.ems-iot.com/relay/v1/g/${ID}`)],
  ['a query or fragment is refused', () => [`${REMOTE_TLS}/?x=1`, `${REMOTE_TLS}#x`].forEach(refused)],
  [
    'only a first label equal to the gateway id counts',
    () => [`https://evil.${ID}.r.ems-iot.com`, `https://${ID}x.r.ems-iot.com`, 'https://other-gateway.r.ems-iot.com', `https://x${ID}.r.ems-iot.com`].forEach(refused),
  ],
  ['a name in a zone the relay doesn\'t issue in is refused', () => [`https://${ID}.attacker.example`, `https://${ID}.gw.ems-iot.com.attacker.example`, `https://${ID}.ems-iot.com`].forEach(refused)],
  ['other zones count only when configured', () => equal(gatewayTlsUrl(`https://${ID}.cube.example.org`, ID, ['cube.example.org']), `https://${ID}.cube.example.org`)],
  ['credentials in the address are refused', () => [`https://${ID}.r.ems-iot.com@evil.test`, `https://user@${ID}.r.ems-iot.com`].forEach(refused)],
  ['the bare id, an IP address and a trailing dot are refused', () => [`https://${ID}`, `https://${ID}:8443`, 'https://192.168.1.20:8443', `https://${ID}.r.ems-iot.com.`].forEach(refused)],
  ['a port out of range is refused', () => [`https://${ID}.gw.ems-iot.com:0`, `https://${ID}.gw.ems-iot.com:70000`].forEach(refused)],
  ['a missing or non-text value is refused', () => [null, undefined, 42, {}, ''].forEach(refused)],
  [
    'a verified gateway’s HTTPS names are stored beside its other addresses',
    () =>
      equal(withTlsEndpoints({ lan: LAN, remote: [RELAY] }, ID, health(tls(LAN_TLS, REMOTE_TLS))), {
        lan: LAN,
        remote: [RELAY],
        lanTls: LAN_TLS,
        remoteTls: REMOTE_TLS,
      }),
  ],
  [
    'a name for another gateway is ignored, and the valid one kept',
    () =>
      equal(withTlsEndpoints({ lan: LAN }, ID, health(tls('https://someone-else.gw.ems-iot.com:8443', REMOTE_TLS))), {
        lan: LAN,
        lanTls: undefined,
        remoteTls: REMOTE_TLS,
      }),
  ],
  [
    'names the gateway stops reporting are dropped (no tls, tls null, or a null URL)',
    () => {
      const stored = { lan: LAN, lanTls: LAN_TLS, remoteTls: REMOTE_TLS };
      equal(withTlsEndpoints(stored, ID, health()), { lan: LAN }, 'no tls');
      equal(withTlsEndpoints(stored, ID, health(null)), { lan: LAN }, 'tls null');
      equal(withTlsEndpoints(stored, ID, health(tls(null, REMOTE_TLS))), { lan: LAN, remoteTls: REMOTE_TLS }, 'lan_url null');
    },
  ],
  [
    'addresses are tried in order: last, home HTTPS, home, remote HTTPS, other remote',
    () =>
      equal(endpointAttempts(gateway(TAILSCALE, { lan: LAN, lanTls: LAN_TLS, remoteTls: REMOTE_TLS, remote: [RELAY, TAILSCALE] })), [
        plain(TAILSCALE),
        lanTls(LAN_TLS),
        plain(LAN),
        remoteTls(REMOTE_TLS),
        plain(RELAY),
      ]),
  ],
  [
    'the last address that worked is tried once, as an HTTPS name when it is one',
    () =>
      equal(endpointAttempts(gateway(LAN_TLS, { lan: LAN, lanTls: LAN_TLS, remote: [RELAY] })), [
        lanTls(LAN_TLS),
        plain(LAN),
        plain(RELAY),
      ]),
  ],
  [
    'only an exact match with a stored HTTPS name skips the identity check',
    () =>
      equal(endpointAttempts(gateway(`${REMOTE_TLS}/`, { remoteTls: REMOTE_TLS, remote: [`https://${ID}.r.ems-iot.com:443`] })), [
        plain(`${REMOTE_TLS}/`),
        remoteTls(REMOTE_TLS),
        plain(`https://${ID}.r.ems-iot.com:443`),
      ]),
  ],
  [
    'a gateway without HTTPS names is tried exactly as before',
    () => {
      equal(endpointAttempts(gateway(LAN, { lan: LAN, remote: [RELAY] })), [plain(LAN), plain(RELAY)], 'home gateway');
      equal(endpointAttempts(gateway(null, { remote: [RELAY] })), [plain(RELAY)], 'gateway on CUBE\u2019s server');
    },
  ],
  [
    'the home HTTPS name gives up sooner than the other addresses',
    () => {
      if (!(gatewayConfig.lanTlsTimeoutMs < gatewayConfig.healthTimeoutMs)) {
        throw new Error(`lanTlsTimeoutMs ${gatewayConfig.lanTlsTimeoutMs} >= healthTimeoutMs ${gatewayConfig.healthTimeoutMs}`);
      }
    },
  ],
];

let failed = 0;
checks.forEach(([name, check], index) => {
  try {
    check();
    console.log(`PASS  ${index + 1}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${index + 1}. ${name}\n        ${(error as Error).message}`);
  }
});
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exitCode = failed ? 1 : 0;
