import { randomBytes, randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { docker, dockerOk, ensureImage, hasImage } from '../integrations/docker.ts';
import { log } from '../log.ts';
import * as store from '../repositories/gatewayContainers.ts';
import { deleteGateway, findGatewayOfUnit } from '../repositories/gateways.ts';
import { attachGateway, publicKey } from './gatewayAccess.ts';

/**
 * The CUBE gateway of each apartment, run by this backend on the server's Docker, so an apartment building
 * management creates comes with its gateway (config.gateways; on when GATEWAY_RELAY_ENROLL_TOKEN is set).
 * Starting one:
 *   1. picks its id and container name, and a free local port from GATEWAY_PORTS (skipping gateways that
 *      new-apartment.sh started),
 *   2. links it to the unit with a new sync secret before it runs, so its first member check is accepted,
 *   3. pulls the image, so a new gateway gets the newest build of GATEWAY_IMAGE (an older copy is used only when the
 *      pull fails), then creates and starts the container as new-apartment.sh does without a tunnel box: host network,
 *      127.0.0.1:<port>, enrolled with the relay, the backend's pass key pinned, its data in a volume of its name,
 *   4. waits until it has checked in here and answers through the relay at its address, as phones reach it.
 * Updating pulls the image again and recreates the container with the same settings and data (a tunnel box that
 * new-apartment.sh added later included). Removing it removes the container and the link; the volume stays, and the
 * unit keeps the gateway's id, so making it again brings the same gateway back (the volume holds that id: a new one
 * would never match it).
 */

const PREFIX = 'cube-gw-';
/** A gateway that checked in this recently counts as running without waiting for its next check (every 5 min). */
const RECENT_SYNC_MS = 6 * 60_000;
const POLL_MS = 2_000;

interface ContainerInfo {
  Config?: { Env?: string[]; Labels?: Record<string, string>; User?: string; ExposedPorts?: Record<string, object> };
  HostConfig?: Record<string, unknown>;
  State?: { Running?: boolean };
}

class Cancelled extends Error {}

export const gatewayContainersEnabled = () => Boolean(config.gateways.relayEnrollToken && config.gateways.emsUrl);

/** Readable in `docker ps` and usable as new-apartment.sh's apartment name: cube-gw-tower-a-1203-3f9a. */
export function containerNameFor(unitId: string, unitName: string): string {
  const slug = unitName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  const tag = unitId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `${PREFIX}${slug ? `${slug}-${tag.slice(0, 4)}` : tag.slice(0, 12)}`;
}

const envValue = (env: string[] | undefined, key: string) => env?.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';

async function inspect(name: string): Promise<ContainerInfo | null> {
  const found = await docker('GET', `/containers/${encodeURIComponent(name)}/json`);
  if (found.status === 404) {
    return null;
  }
  if (found.status >= 400) {
    throw new Error(`Docker could not inspect ${name} (HTTP ${found.status}).`);
  }
  return found.body as ContainerInfo;
}

let portLock: Promise<unknown> = Promise.resolve();

/** The lowest port in GATEWAY_PORTS no gateway uses, ours or new-apartment.sh's; one allocation at a time. */
function allocatePort(unitId: string): Promise<number> {
  const job = portLock.then(async () => {
    const used = new Set(store.usedGatewayPorts());
    const filters = encodeURIComponent(JSON.stringify({ name: [PREFIX] }));
    const listed = (await dockerOk('GET', `/containers/json?all=1&filters=${filters}`)) as { Names?: string[] }[];
    for (const container of listed) {
      const name = container.Names?.find((entry) => entry.startsWith(`/${PREFIX}`));
      const port = name ? Number(envValue((await inspect(name.slice(1)))?.Config?.Env, 'CUBE_PORT')) : 0;
      if (port) {
        used.add(port);
      }
    }
    const { first, last } = config.gateways.ports;
    for (let port = first; port <= last; port += 1) {
      if (!used.has(port)) {
        store.updateGatewayContainer(unitId, { port });
        return port;
      }
    }
    throw new Error(`No free port left in GATEWAY_PORTS (${first}-${last}).`);
  });
  portLock = job.catch(() => undefined);
  return job;
}

/** A new container, as new-apartment.sh starts one without a tunnel box. */
function newContainer(row: store.GatewayContainer, unitName: string, port: number, secret: string) {
  const settings = config.gateways;
  const optional = Object.entries({
    CUBE_CLOUD_MQTT_URL: settings.cloudMqttUrl,
    CUBE_RETHINK_MQTT_URL: settings.rethinkMqttUrl,
    CUBE_RETHINK_API_SERVER: settings.rethinkApiServer,
    CUBE_RETHINK_MQTT_SERVER: settings.rethinkMqttServer,
  })
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`);
  return {
    Image: settings.image,
    Env: [
      'CUBE_SERVER_HOSTED=1',
      'CUBE_HOST=127.0.0.1',
      `CUBE_PORT=${port}`,
      'CUBE_MDNS_ADVERTISE=0',
      'CUBE_SUBNET_SCAN=0',
      `CUBE_GATEWAY_NAME=CUBE ${unitName}`,
      `CUBE_GATEWAY_ID=${row.gatewayId}`,
      `CUBE_EMS_URL=${settings.emsUrl}`,
      `CUBE_EMS_SECRET=${secret}`,
      // Pinned from the start rather than fetched on first use.
      `CUBE_EMS_KEY=${publicKey().key}`,
      `CUBE_RELAY_URL=${settings.relayUrl}`,
      `CUBE_RELAY_ENROLL_TOKEN=${settings.relayEnrollToken}`,
      ...optional,
    ],
    Labels: { 'parklane.role': 'gateway', 'parklane.unit': row.unitId },
    HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' }, Binds: [`${row.containerName}:/data`] },
  };
}

/** The same container on a newer image: its CUBE_* settings, data, network and ports (a tunnel box's too). */
function sameContainer(info: ContainerInfo, image: string) {
  const host = info.HostConfig ?? {};
  const kept = ['Binds', 'NetworkMode', 'PortBindings', 'CapAdd', 'ExtraHosts', 'RestartPolicy', 'Memory'].filter((key) => host[key] != null);
  return {
    Image: image,
    // Only the gateway's own settings: the rest of the environment (PATH, …) comes from the new image.
    Env: (info.Config?.Env ?? []).filter((entry) => entry.startsWith('CUBE_')),
    Labels: info.Config?.Labels ?? {},
    User: info.Config?.User ?? '',
    ExposedPorts: info.Config?.ExposedPorts,
    HostConfig: Object.fromEntries(kept.map((key) => [key, host[key]])),
  };
}

const running = new Map<string, Promise<void>>();

/**
 * Starts (or retries, or with `update` refreshes) the unit's gateway in the background and returns its row.
 * Refused when the unit already has another gateway linked, such as a box at home.
 */
export function provisionGateway(unitId: string, unitName: string, { update = false } = {}): store.GatewayContainer {
  if (!gatewayContainersEnabled()) {
    throw new ApiError('not_configured', 'This server makes no gateways by itself: set GATEWAY_RELAY_ENROLL_TOKEN and PUBLIC_URL in backend/.env.');
  }
  const existing = store.findGatewayContainer(unitId);
  const linked = findGatewayOfUnit(unitId);
  update &&= existing?.status !== 'removed';
  if (linked && linked.id !== existing?.gatewayId) {
    throw new ApiError('conflict', 'This apartment already has a gateway linked. Unlink it first to make one on the server.');
  }
  if (!existing) {
    store.insertGatewayContainer(unitId, randomUUID(), containerNameFor(unitId, unitName), new Date().toISOString());
  }
  if (!running.has(unitId)) {
    store.updateGatewayContainer(unitId, { status: 'provisioning', lastError: null });
    const row = store.findGatewayContainer(unitId) as store.GatewayContainer;
    const job = provision(row, unitName, update)
      .then(() => {
        store.updateGatewayContainer(unitId, { status: 'running', lastError: null });
        log.info('Unit gateway running', { unit: unitId, container: row.containerName, gateway: row.gatewayId });
      })
      .catch((error: unknown) => {
        if (error instanceof Cancelled) {
          return;
        }
        log.error('Starting a unit gateway failed', { unit: unitId, container: row.containerName, reason: (error as Error).message });
        store.updateGatewayContainer(unitId, { status: 'failed', lastError: (error as Error).message });
      })
      .finally(() => running.delete(unitId));
    running.set(unitId, job);
  }
  return store.findGatewayContainer(unitId) as store.GatewayContainer;
}

/** For tests. */
export function gatewayProvisioningDone(unitId: string): Promise<void> {
  return running.get(unitId) ?? Promise.resolve();
}

/** A new gateway gets the newest build of the tag; when the registry can't be reached, the copy Docker already has. */
async function pullNewest(image: string): Promise<void> {
  try {
    await ensureImage(image, { pull: true });
  } catch (error) {
    if (!(await hasImage(image))) {
      throw error;
    }
    log.warn('Pulling the gateway image failed; using the copy already on this server', { image, reason: (error as Error).message });
  }
}

async function provision(row: store.GatewayContainer, unitName: string, update: boolean): Promise<void> {
  const settings = config.gateways;
  const name = row.containerName;
  // Removed meanwhile (or its apartment deleted): take away what this job made and stop.
  const stillWanted = async () => {
    if ((store.findGatewayContainer(row.unitId)?.status ?? 'removed') === 'removed') {
      await dockerOk('DELETE', `/containers/${name}?force=true`, undefined, [404]);
      throw new Cancelled();
    }
  };
  const info = await inspect(name);
  if (update) {
    await ensureImage(settings.image, { pull: true });
  } else if (!info) {
    await pullNewest(settings.image);
  }
  const kept = envValue(info?.Config?.Env, 'CUBE_EMS_SECRET');
  if (info && !kept) {
    throw new Error(`${name} has no CUBE_EMS_SECRET. Remove the container (docker rm -f ${name}) and try again: its data stays.`);
  }
  const secret = kept || randomBytes(32).toString('hex');
  await stillWanted();
  attachGateway(row.unitId, row.gatewayId, secret, `${settings.relayUrl}/relay/v1/g/${row.gatewayId}`);

  let since = Date.now();
  if (info && update) {
    await dockerOk('DELETE', `/containers/${name}?force=true`, undefined, [404]);
    await dockerOk('POST', `/containers/create?name=${name}`, sameContainer(info, settings.image));
  } else if (!info) {
    const port = row.port ?? (await allocatePort(row.unitId));
    await dockerOk('POST', `/containers/create?name=${name}`, newContainer(row, unitName, port, secret));
  } else if (info.State?.Running) {
    const lastSync = Date.parse(findGatewayOfUnit(row.unitId)?.lastSync ?? '');
    if (Date.now() - lastSync < RECENT_SYNC_MS) {
      since = lastSync;
    } else {
      // Running but not checking in (it was unlinked, say): a restart makes it check at once.
      await dockerOk('POST', `/containers/${name}/restart`);
    }
  }
  await stillWanted();
  await dockerOk('POST', `/containers/${name}/start`, undefined, [304]);
  await waitUntilReady(row, since, stillWanted);
}

/** Until the gateway has checked in here since `since` and answers through the relay with its own id. */
async function waitUntilReady(row: store.GatewayContainer, since: number, stillWanted: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + config.gateways.startTimeoutMs;
  const health = `${config.gateways.relayUrl}/relay/v1/g/${row.gatewayId}/api/v1/health`;
  let checkedIn = false;
  let relayed = false;
  let relayProblem = 'no answer yet';
  for (;;) {
    await stillWanted();
    const lastSync = findGatewayOfUnit(row.unitId)?.lastSync;
    checkedIn ||= Boolean(lastSync && Date.parse(lastSync) >= since);
    if (!relayed) {
      try {
        const response = await fetch(health, { signal: AbortSignal.timeout(5_000) });
        const body = (response.ok ? await response.json() : null) as { data?: { gateway_id?: string } } | null;
        relayed = body?.data?.gateway_id === row.gatewayId;
        relayProblem = relayed ? '' : `the relay answered HTTP ${response.status}`;
      } catch (error) {
        relayProblem = (error as Error).message;
      }
    }
    if (checkedIn && relayed) {
      return;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (!checkedIn) {
    throw new Error(
      `The gateway didn't check in with this backend. Is ${config.gateways.emsUrl} reachable from the server, and is the image new enough (it must know CUBE_GATEWAY_ID)? Its log: docker logs ${row.containerName}`,
    );
  }
  throw new Error(`The gateway checked in but doesn't answer through the relay (${relayProblem}). Check GATEWAY_RELAY_ENROLL_TOKEN. Its log: docker logs ${row.containerName}`);
}

/**
 * Removes the unit's gateway container and its link. Its volume (paired devices, keys) stays until removed by hand.
 * With `forget` (the apartment is deleted) the unit's row goes too; otherwise it keeps the id for making it again.
 */
export async function removeGatewayContainer(unitId: string, { forget = false } = {}): Promise<boolean> {
  const row = store.findGatewayContainer(unitId);
  if (!row || (row.status === 'removed' && !forget)) {
    return false;
  }
  // First, so a job still starting it stops (stillWanted).
  if (forget) {
    store.deleteGatewayContainer(unitId);
  } else {
    store.updateGatewayContainer(unitId, { status: 'removed', lastError: null });
  }
  const linked = findGatewayOfUnit(unitId);
  if (linked?.id === row.gatewayId) {
    deleteGateway(linked.id);
  }
  await dockerOk('DELETE', `/containers/${row.containerName}?force=true`, undefined, [404]);
  return true;
}

export const gatewayContainerOf = (unitId: string) => store.findGatewayContainer(unitId);
export const gatewayContainers = () => store.listGatewayContainers();
