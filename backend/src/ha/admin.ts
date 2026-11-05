import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { createHubRow, getHubForUnit, startHub, updateHubRow, type Hub } from './hubs.ts';
import { withConnection } from './provisioner.ts';
import { getUnit } from './units.ts';

/**
 * Attaching a hub that runs somewhere else, e.g. a box in a unit that wants
 * Zigbee or local devices, reached over WireGuard. Its address must resolve
 * inside HA_ALLOWED_NETWORKS, so an admin key cannot point the backend (and
 * the token it sends) at an arbitrary host.
 */

function allowedNetworks(): BlockList {
  const list = new BlockList();
  for (const cidr of config.ha.allowedNetworks) {
    const [network, bits] = cidr.split('/');
    const type = isIP(network) === 6 ? 'ipv6' : 'ipv4';
    list.addSubnet(network, Number(bits ?? (type === 'ipv6' ? 128 : 32)), type);
  }
  return list;
}

export async function checkHubAddress(baseUrlInput: unknown): Promise<string> {
  let url: URL;
  try {
    url = new URL(typeof baseUrlInput === 'string' ? baseUrlInput : '');
  } catch {
    throw new ApiError('bad_request', 'baseUrl must be an http(s) address, e.g. http://100.64.0.12:8123.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/') {
    throw new ApiError('bad_request', 'baseUrl must be a plain http(s) address with no path or credentials.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  const allowed = allowedNetworks();
  if (addresses.length === 0 || !addresses.every((entry) => allowed.check(entry.address, entry.family === 6 ? 'ipv6' : 'ipv4'))) {
    throw new ApiError('forbidden', 'That address is outside HA_ALLOWED_NETWORKS.');
  }
  return url.origin;
}

export async function attachHub(unitId: string, baseUrlInput: unknown, tokenInput: unknown): Promise<Hub> {
  getUnit(unitId);
  const baseUrl = await checkHubAddress(baseUrlInput);
  if (typeof tokenInput !== 'string' || tokenInput.length < 20) {
    throw new ApiError('bad_request', 'token must be a Home Assistant long-lived access token.');
  }
  const existing = getHubForUnit(unitId);
  if (existing && existing.kind === 'container') {
    throw new ApiError('conflict', 'This unit already has a server hub. Remove the unit to switch it to a box.');
  }
  const haVersion = await withConnection(baseUrl, tokenInput, async (connection) => {
    const info = await connection.command<{ version?: string }>({ type: 'get_config' });
    return info.version ?? null;
  }).catch((error: Error) => {
    throw new ApiError('hub_auth', `Could not sign in to that hub: ${error.message}`);
  });
  const hub = existing ?? createHubRow(unitId, 'box', null);
  updateHubRow(hub.id, { baseUrl, token: tokenInput, haVersion, status: 'offline', lastError: null });
  startHub(hub.id);
  return getHubForUnit(unitId) as Hub;
}
