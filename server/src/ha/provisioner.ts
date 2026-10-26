import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { HaConnection } from './haClient.ts';
import { createHubRow, getHubForUnit, hubHasToken, startHub, stopHub, updateHubRow, type Hub } from './hubs.ts';

/**
 * Runs one Home Assistant container per unit on this server's Docker, so
 * residents need no hardware at home: their devices come in through the
 * brands' clouds (Tuya, SmartThings, …), which HA reaches from here.
 *
 * Talks to the Docker Engine API over its socket with node:http, keeping the
 * backend dependency-free. Provisioning a unit:
 *   1. writes /config/configuration.yaml (cloud integrations only),
 *   2. creates and starts the container on the private network,
 *   3. waits for HA, creates its admin user through onboarding and swaps the
 *      first token for a long-lived one,
 *   4. adds the company's shared OAuth app credentials,
 *   5. stores the address and sealed token, and connects (hubs.ts).
 * Removing a unit removes its container; its /config folder is kept, since
 * it holds the resident's linked accounts, until an operator deletes it.
 */

const FACADE_USER = 'parklane-facade';
const CONTAINER_PORT = '8123/tcp';

// ---- Docker Engine API ---------------------------------------------------------------------

interface DockerResponse {
  status: number;
  body: unknown;
}

export function docker(method: string, path: string, body?: unknown): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: config.ha.dockerSocket,
        path,
        method,
        headers: { Host: 'docker', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = text;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            // Image pulls stream one JSON object per line; callers only need the status.
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', (error) => reject(new ApiError('not_configured', `Docker is not reachable at ${config.ha.dockerSocket}: ${error.message}`)));
    req.end(payload);
  });
}

async function dockerOk(method: string, path: string, body?: unknown, allowed: readonly number[] = []): Promise<unknown> {
  const response = await docker(method, path, body);
  if (response.status >= 400 && !allowed.includes(response.status)) {
    const message = (response.body as { message?: string } | null)?.message ?? `HTTP ${response.status}`;
    throw new Error(`Docker ${method} ${path.split('?')[0]}: ${message}`);
  }
  return response.body;
}

async function ensureNetwork(): Promise<void> {
  const found = await docker('GET', `/networks/${encodeURIComponent(config.ha.network)}`);
  if (found.status === 404) {
    // Not internal: HA has to reach the brands' clouds.
    await dockerOk('POST', '/networks/create', { Name: config.ha.network, Driver: 'bridge', Labels: { 'parklane.role': 'ha' } });
  }
}

async function ensureImage(): Promise<void> {
  const found = await docker('GET', `/images/${encodeURIComponent(config.ha.image)}/json`);
  if (found.status === 404) {
    const colon = config.ha.image.lastIndexOf(':');
    const [image, tag] = colon > config.ha.image.lastIndexOf('/') ? [config.ha.image.slice(0, colon), config.ha.image.slice(colon + 1)] : [config.ha.image, 'latest'];
    await dockerOk('POST', `/images/create?fromImage=${encodeURIComponent(image)}&tag=${encodeURIComponent(tag)}`);
  }
}

export function containerNameFor(unitId: string): string {
  return `parklane-ha-${unitId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase()}`;
}

/** The unit's HA configuration: what a server-side, cloud-only hub needs and nothing more. */
export function configurationYaml(unitName: string): string {
  return [
    '# Written by the Park-Lane backend. This Home Assistant runs on the company server,',
    '# so it reaches devices through their makers\' clouds: no discovery, Bluetooth or USB.',
    'homeassistant:',
    `  name: ${JSON.stringify(unitName)}`,
    `  time_zone: ${JSON.stringify(config.ha.timeZone)}`,
    '',
    '# Brings in api, auth, config, onboarding and websocket_api.',
    'frontend:',
    'application_credentials:',
    'recorder:',
    '  purge_keep_days: 3',
    '',
  ].join('\n');
}

function writeConfig(unitId: string, unitName: string): string {
  const dir = join(config.ha.configRoot, unitId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'configuration.yaml');
  if (!existsSync(file)) {
    writeFileSync(file, configurationYaml(unitName), { mode: 0o600 });
  }
  return config.ha.configHostRoot ? `${config.ha.configHostRoot.replace(/[/\\]+$/, '')}/${unitId}` : dir;
}

async function startContainer(name: string, hostConfigDir: string, unitId: string): Promise<string> {
  const existing = await docker('GET', `/containers/${name}/json`);
  if (existing.status === 404) {
    await dockerOk('POST', `/containers/create?name=${name}`, {
      Image: config.ha.image,
      Env: [`TZ=${config.ha.timeZone}`],
      Labels: { 'parklane.role': 'ha', 'parklane.unit': unitId },
      ExposedPorts: { [CONTAINER_PORT]: {} },
      HostConfig: {
        Binds: [`${hostConfigDir}:/config`],
        NetworkMode: config.ha.network,
        RestartPolicy: { Name: 'unless-stopped' },
        Memory: config.ha.memoryMb * 1024 * 1024,
        ...(config.ha.publishLocalPorts ? { PortBindings: { [CONTAINER_PORT]: [{ HostIp: '127.0.0.1', HostPort: '' }] } } : {}),
      },
    });
  }
  // 304: already running.
  await dockerOk('POST', `/containers/${name}/start`, undefined, [304]);
  if (!config.ha.publishLocalPorts) {
    return `http://${name}:8123`;
  }
  const info = (await dockerOk('GET', `/containers/${name}/json`)) as {
    NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> };
  };
  const port = info.NetworkSettings?.Ports?.[CONTAINER_PORT]?.[0]?.HostPort;
  if (!port) {
    throw new Error('Docker did not publish the container port.');
  }
  return `http://127.0.0.1:${port}`;
}

// ---- Home Assistant onboarding ---------------------------------------------------------------

async function waitForHa(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + config.ha.startTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/onboarding`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const steps = (await response.json()) as { step: string; done: boolean }[];
        return !steps.find((step) => step.step === 'user')?.done;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Home Assistant did not start in time.');
}

/**
 * Creates the facade's admin user and returns a long-lived token for it.
 * Only the user step is completed: the later onboarding steps add weather,
 * TTS and shopping-list integrations a unit's hub has no use for.
 */
export async function onboard(baseUrl: string): Promise<{ token: string; password: string }> {
  const clientId = `${baseUrl}/`;
  const password = randomBytes(24).toString('base64url');
  const user = await fetch(`${baseUrl}/api/onboarding/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, name: 'Park-Lane', username: FACADE_USER, password, language: 'en' }),
  });
  if (!user.ok) {
    throw new Error(`Onboarding refused the admin user (HTTP ${user.status}).`);
  }
  const { auth_code: code } = (await user.json()) as { auth_code: string };

  const tokenResponse = await fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Home Assistant refused the onboarding code (HTTP ${tokenResponse.status}).`);
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  const token = await withConnection(baseUrl, accessToken, (connection) =>
    connection.command<string>({ type: 'auth/long_lived_access_token', client_name: 'Park-Lane backend', lifespan: 3650 }),
  );
  return { token, password };
}

/** Opens a short-lived connection, runs `work`, and closes it. */
export async function withConnection<T>(baseUrl: string, token: string, work: (connection: HaConnection) => Promise<T>): Promise<T> {
  let settle: { resolve: (value: T) => void; reject: (error: Error) => void } | null = null;
  const result = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const connection = new HaConnection({
    baseUrl,
    token,
    onReady: async (ready) => {
      try {
        settle?.resolve(await work(ready));
      } catch (error) {
        settle?.reject(error as Error);
      }
    },
    onStatus: (status, detail) => {
      if (status === 'auth_failed') {
        settle?.reject(new Error(detail.error ?? 'Home Assistant refused the token.'));
      }
    },
  });
  connection.start();
  const timeout = setTimeout(() => settle?.reject(new Error('Home Assistant did not answer in time.')), 30_000);
  try {
    return await result;
  } finally {
    clearTimeout(timeout);
    connection.stop();
  }
}

async function addOAuthCredentials(baseUrl: string, token: string): Promise<void> {
  const entries = Object.entries(config.ha.oauthCredentials);
  if (entries.length === 0) {
    return;
  }
  await withConnection(baseUrl, token, async (connection) => {
    for (const [domain, credential] of entries) {
      await connection
        .command({ type: 'application_credentials/create', domain, client_id: credential.clientId, client_secret: credential.clientSecret, name: 'Park-Lane' })
        .catch((error: Error) => log.warn('Adding OAuth credentials failed', { domain, reason: error.message }));
    }
  });
}

// ---- Units ---------------------------------------------------------------------------------

const running = new Map<string, Promise<void>>();

/**
 * Starts provisioning a unit's hub in the background and returns its row.
 * Safe to call again after a failure: it resumes from what already exists.
 */
export function provisionUnit(unitId: string, unitName: string): Hub {
  const hub = getHubForUnit(unitId) ?? createHubRow(unitId, 'container', containerNameFor(unitId));
  if (hub.kind !== 'container') {
    throw new ApiError('conflict', 'This unit uses a hub in the home, not a server container.');
  }
  if (!running.has(unitId)) {
    updateHubRow(hub.id, { status: 'provisioning', lastError: null });
    const job = provision(hub, unitId, unitName)
      .catch((error: unknown) => {
        log.error('Provisioning a unit hub failed', { unit: unitId, reason: (error as Error).message });
        updateHubRow(hub.id, { status: 'failed', lastError: (error as Error).message });
      })
      .finally(() => running.delete(unitId));
    running.set(unitId, job);
  }
  return getHubForUnit(unitId) as Hub;
}

/** For tests and graceful shutdown. */
export function provisioningDone(unitId: string): Promise<void> {
  return running.get(unitId) ?? Promise.resolve();
}

async function provision(hub: Hub, unitId: string, unitName: string): Promise<void> {
  const name = hub.containerName ?? containerNameFor(unitId);
  await ensureNetwork();
  await ensureImage();
  const baseUrl = await startContainer(name, writeConfig(unitId, unitName), unitId);
  updateHubRow(hub.id, { baseUrl });

  const fresh = await waitForHa(baseUrl);
  if (fresh) {
    const { token, password } = await onboard(baseUrl);
    updateHubRow(hub.id, { token, adminPassword: password });
    await addOAuthCredentials(baseUrl, token);
  } else if (!hubHasToken(hub.id)) {
    throw new Error('Home Assistant was already onboarded, but this backend has no token for it.');
  }
  updateHubRow(hub.id, { status: 'offline', lastError: null });
  startHub(hub.id);
  log.info('Unit hub provisioned', { unit: unitId, container: name });
}

/** Stops and removes the unit's container. Its /config folder stays (see above). */
export async function deprovisionUnit(unitId: string): Promise<void> {
  const hub = getHubForUnit(unitId);
  if (!hub) {
    return;
  }
  stopHub(hub.id);
  if (hub.kind === 'container' && hub.containerName) {
    await dockerOk('DELETE', `/containers/${hub.containerName}?force=true`, undefined, [404]);
  }
}
