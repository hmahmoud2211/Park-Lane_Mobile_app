import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

/**
 * Apartments come with their CUBE gateway: creating a unit starts a gateway container on the server's Docker (a
 * stand-in Engine API on a socket), links it to the unit, and waits until the "gateway" checks in with the backend
 * and answers through a stand-in relay, as a real one does. Then updating, failing, retrying and removing it.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const dataDir = mkdtempSync(join(tmpdir(), 'ems-gateways-'));
const socketPath = join(dataDir, 'docker.sock');
const appPort = await freePort();
const relayPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const ADMIN = 'admin-key-for-gateway-containers';
const IMAGE = 'hmahmoud2211/cube-os-gateway:latest';

Object.assign(process.env, {
  DATA_DIR: dataDir,
  ADMIN_API_KEY: ADMIN,
  DOCKER_SOCKET: socketPath,
  PUBLIC_URL: BASE,
  GATEWAY_RELAY_ENROLL_TOKEN: 'relay-enrol-token',
  GATEWAY_RELAY_URL: `http://127.0.0.1:${relayPort}`,
  GATEWAY_PORTS: '18750-18753',
  GATEWAY_START_TIMEOUT_MS: '1500',
});

const { createApp } = await import('../src/app.ts');
const { gatewayProvisioningDone } = await import('../src/ems/gatewayProvisioner.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

interface FakeContainer {
  body: { Image: string; Env: string[]; Labels?: Record<string, string>; HostConfig: Record<string, unknown> };
  running: boolean;
}

/** What the stand-in Docker holds. A script-made gateway already uses the first port. */
const containers = new Map<string, FakeContainer>([
  ['cube-gw-old-apartment', { body: { Image: IMAGE, Env: ['CUBE_PORT=18750'], HostConfig: { NetworkMode: 'host' } }, running: true }],
]);
const calls: string[] = [];
/** Gateways that answer through the relay, by id. */
const onRelay = new Set<string>();
/** When set, started gateways stay silent: no check-in, nothing on the relay. */
let silent = false;
/** Whether Docker has the image, and whether pulling it fails (as on a rate limit: HTTP 200, the error in the stream). */
let imagePresent = false;
let pullFails = false;
const pulls = () => calls.filter((call) => call === 'POST /images/create').length;

const envOf = (container: FakeContainer, key: string) => container.body.Env.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';

/** What a real gateway does on starting: checks in for its members, and connects to the relay. */
async function boot(container: FakeContainer) {
  if (silent) return;
  const id = envOf(container, 'CUBE_GATEWAY_ID');
  const response = await fetch(`${envOf(container, 'CUBE_EMS_URL')}/api/gateway/members`, {
    headers: { Authorization: `Bearer ${id}.${envOf(container, 'CUBE_EMS_SECRET')}` },
  });
  assert.equal(response.status, 200, 'the gateway checks in with the secret it was started with');
  onRelay.add(id);
}

function dockerApi(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://docker');
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push(`${req.method} ${url.pathname}`);
    const json = (status: number, payload: unknown = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname.startsWith('/images/') && url.pathname.endsWith('/json')) return json(imagePresent ? 200 : 404, {});
    if (url.pathname === '/images/create') {
      if (pullFails) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"status":"Pulling from hmahmoud2211/cube-os-gateway"}\n{"errorDetail":{"message":"toomanyrequests"},"error":"toomanyrequests: pull rate limit"}\n');
      }
      imagePresent = true;
      return json(200, { status: 'Downloaded newer image' });
    }
    if (url.pathname === '/containers/json') {
      return json(200, [...containers.keys()].map((name) => ({ Names: [`/${name}`] })));
    }
    if (url.pathname === '/containers/create') {
      const name = url.searchParams.get('name') as string;
      if (containers.has(name)) return json(409, { message: 'name in use' });
      containers.set(name, { body, running: false });
      return json(201, { Id: name });
    }
    const match = /^\/containers\/([^/]+)(\/start|\/restart|\/json)?$/.exec(url.pathname);
    const container = match ? containers.get(decodeURIComponent(match[1])) : undefined;
    if (!match) return json(404, { message: `unexpected ${req.method} ${url.pathname}` });
    if (!container) return json(404, { message: 'no such container' });
    if (match[2] === '/json') {
      const { Image, Env, Labels, HostConfig } = container.body;
      return json(200, { Config: { Image, Env, Labels }, HostConfig, State: { Running: container.running } });
    }
    if (match[2] === '/start' || match[2] === '/restart') {
      const already = container.running && match[2] === '/start';
      container.running = true;
      json(already ? 304 : 204);
      if (!already) void boot(container);
      return;
    }
    if (req.method === 'DELETE') {
      containers.delete(decodeURIComponent(match[1]));
      return json(204);
    }
    return json(404, { message: `unexpected ${req.method} ${url.pathname}` });
  });
}

function relayApi(req: IncomingMessage, res: ServerResponse) {
  const match = /^\/relay\/v1\/g\/([0-9a-f-]+)\/api\/v1\/health$/.exec(req.url ?? '');
  const known = match && onRelay.has(match[1]);
  res.writeHead(known ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(known ? { data: { gateway_id: match[1] } } : { error: { code: 'offline' } }));
}

let app: Server;
let docker: Server;
let relay: Server;

before(async () => {
  docker = createServer(dockerApi);
  relay = createServer(relayApi);
  app = createApp();
  await new Promise<void>((resolve) => docker.listen(socketPath, resolve));
  await new Promise<void>((resolve) => relay.listen(relayPort, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => app.listen(appPort, '127.0.0.1', resolve));
});

after(async () => {
  closeRealtimeConnections();
  for (const server of [app, docker, relay]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

interface GatewayContainer {
  gatewayId: string;
  containerName: string;
  port: number | null;
  status: string;
  lastError: string | null;
}
interface UnitDetail {
  id: string;
  gateway: { id: string; url: string; lastSync: string | null } | null;
  gatewayContainer: GatewayContainer | null;
}

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ADMIN}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, ...((await response.json()) as { data: T; error?: { code: string; message: string } }) };
}

const detail = async (unitId: string) => (await api<UnitDetail>('GET', `/api/admin/units/${unitId}`)).data;

describe('the gateway that comes with an apartment', () => {
  let unitId = '';
  let first: GatewayContainer;

  test('creating an apartment starts its gateway and links it', async () => {
    assert.deepEqual((await api('GET', '/api/admin/features')).data, { gatewayContainers: true });
    const created = await api<{ id: string; gatewayContainer: GatewayContainer }>('POST', '/api/admin/units', { name: 'Tower A · 1203', provision: false });
    assert.equal(created.status, 200);
    unitId = created.data.id;
    assert.equal(created.data.gatewayContainer.status, 'provisioning');
    assert.match(created.data.gatewayContainer.containerName, /^cube-gw-tower-a-1203-[0-9a-f]{4}$/);
    await gatewayProvisioningDone(unitId);

    const unit = await detail(unitId);
    first = unit.gatewayContainer as GatewayContainer;
    assert.equal(first.status, 'running', first.lastError ?? '');
    assert.equal(first.port, 18751, 'the script-made gateway keeps 18750');
    assert.equal(unit.gateway?.id, first.gatewayId);
    assert.equal(unit.gateway?.url, `http://127.0.0.1:${relayPort}/relay/v1/g/${first.gatewayId}`);
    assert.ok(unit.gateway?.lastSync);

    const container = containers.get(first.containerName) as FakeContainer;
    const key = (await (await fetch(`${BASE}/api/gateway/key`)).json()) as { data: { key: string } };
    assert.equal(container.body.Image, IMAGE);
    assert.equal(envOf(container, 'CUBE_GATEWAY_ID'), first.gatewayId);
    assert.match(envOf(container, 'CUBE_EMS_SECRET'), /^[0-9a-f]{64}$/);
    assert.equal(envOf(container, 'CUBE_EMS_KEY'), key.data.key, 'the pass key is pinned from the start');
    assert.equal(envOf(container, 'CUBE_EMS_URL'), BASE);
    assert.equal(envOf(container, 'CUBE_RELAY_ENROLL_TOKEN'), 'relay-enrol-token');
    assert.equal(envOf(container, 'CUBE_PORT'), '18751');
    assert.equal(envOf(container, 'CUBE_HOST'), '127.0.0.1');
    assert.equal(envOf(container, 'CUBE_SERVER_HOSTED'), '1');
    assert.deepEqual(container.body.HostConfig, { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' }, Binds: [`${first.containerName}:/data`] });
    assert.equal(container.body.Labels?.['parklane.unit'], unitId);
  });

  test('updating recreates it on a fresh image with the same settings, a tunnel box\'s included', async () => {
    const container = containers.get(first.containerName) as FakeContainer;
    const secret = envOf(container, 'CUBE_EMS_SECRET');
    // As if new-apartment.sh had since moved it into its own namespace for a tunnel box.
    container.body.Env.push('CUBE_TUNNEL_SUBNETS=192.168.1.0/24', 'PATH=/old/bin');
    container.body.HostConfig = { ...container.body.HostConfig, NetworkMode: 'bridge', CapAdd: ['NET_ADMIN'], PortBindings: { '51820/udp': [{ HostPort: '51821' }] } };
    const before = pulls();

    assert.equal((await api('POST', `/api/admin/units/${unitId}/gateway`, { update: true })).status, 200);
    await gatewayProvisioningDone(unitId);
    const unit = await detail(unitId);
    assert.equal(unit.gatewayContainer?.status, 'running', unit.gatewayContainer?.lastError ?? '');
    assert.equal(pulls(), before + 1, 'the image is pulled again');

    const recreated = containers.get(first.containerName) as FakeContainer;
    assert.notEqual(recreated, container);
    assert.equal(envOf(recreated, 'CUBE_EMS_SECRET'), secret);
    assert.equal(envOf(recreated, 'CUBE_TUNNEL_SUBNETS'), '192.168.1.0/24');
    assert.equal(envOf(recreated, 'PATH'), '', 'the rest of the environment comes from the new image');
    assert.deepEqual(recreated.body.HostConfig.CapAdd, ['NET_ADMIN']);
    assert.equal(recreated.body.HostConfig.NetworkMode, 'bridge');
    assert.equal(unit.gateway?.id, first.gatewayId);
  });

  test('a gateway that never checks in fails with a reason, and a retry starts it', async () => {
    silent = true;
    const before = pulls();
    const created = await api<{ id: string; gatewayContainer: GatewayContainer }>('POST', '/api/admin/units', { name: 'برج ب ٤', provision: false });
    const id = created.data.id;
    assert.match(created.data.gatewayContainer.containerName, /^cube-gw-[0-9a-f]{12}$/, 'a name without Latin letters falls back to the unit id');
    await gatewayProvisioningDone(id);
    let unit = await detail(id);
    assert.equal(unit.gatewayContainer?.status, 'failed');
    assert.match(unit.gatewayContainer?.lastError ?? '', /didn't check in.*docker logs cube-gw-/);
    assert.equal(unit.gatewayContainer?.port, 18752);
    assert.equal(pulls(), before + 1, 'a new gateway gets the newest image although the server has one');

    silent = false;
    containers.get(unit.gatewayContainer?.containerName as string)!.running = false; // as if it had stopped
    await api('POST', `/api/admin/units/${id}/gateway`, {});
    await gatewayProvisioningDone(id);
    unit = await detail(id);
    assert.equal(unit.gatewayContainer?.status, 'running', unit.gatewayContainer?.lastError ?? '');
    assert.equal(unit.gatewayContainer?.port, 18752, 'the retry keeps its port and container');
  });

  test('when the pull fails, a new gateway starts from the copy the server has, and without one it fails clearly', async () => {
    pullFails = true;
    try {
      const withCopy = (await api<{ id: string }>('POST', '/api/admin/units', { name: 'Tower C · 0101', provision: false })).data.id;
      await gatewayProvisioningDone(withCopy);
      assert.equal((await detail(withCopy)).gatewayContainer?.status, 'running');

      imagePresent = false;
      const without = (await api<{ id: string }>('POST', '/api/admin/units', { name: 'Tower C · 0102', provision: false })).data.id;
      await gatewayProvisioningDone(without);
      const failed = (await detail(without)).gatewayContainer;
      assert.equal(failed?.status, 'failed');
      assert.match(failed?.lastError ?? '', /could not pull hmahmoud2211\/cube-os-gateway:latest: toomanyrequests/);
      await api('DELETE', `/api/admin/units/${withCopy}`);
      await api('DELETE', `/api/admin/units/${without}`);
    } finally {
      pullFails = false;
      imagePresent = true;
    }
  });

  test('an apartment with a box at home linked gets no second gateway', async () => {
    const created = await api<{ id: string }>('POST', '/api/admin/units', { name: 'Villa 7', provision: false, gateway: false });
    const box = '6f1c2b9e-0d4a-4e8f-9b7c-1a2b3c4d5e6f';
    await api('POST', '/api/admin/gateways', { unitId: created.data.id, gatewayId: box, secret: 'b'.repeat(64), url: 'https://cube-relay.ems-iot.com/relay/v1/g/x' });
    const refused = await api('POST', `/api/admin/units/${created.data.id}/gateway`, {});
    assert.equal(refused.status, 409);
    assert.equal(refused.error?.code, 'conflict');
    assert.equal((await detail(created.data.id)).gateway?.id, box);
  });

  test('removing the gateway keeps its id, so starting it again brings the same one back', async () => {
    const name = first.containerName;
    assert.equal((await api<{ removed: boolean }>('DELETE', `/api/admin/units/${unitId}/gateway`)).data.removed, true);
    assert.ok(!containers.has(name));
    let unit = await detail(unitId);
    assert.equal(unit.gateway, null, 'residents get no passes for it any more');
    assert.equal(unit.gatewayContainer?.status, 'removed');
    assert.equal((await api<{ removed: boolean }>('DELETE', `/api/admin/units/${unitId}/gateway`)).data.removed, false);

    await api('POST', `/api/admin/units/${unitId}/gateway`, {});
    await gatewayProvisioningDone(unitId);
    unit = await detail(unitId);
    assert.equal(unit.gatewayContainer?.status, 'running', unit.gatewayContainer?.lastError ?? '');
    assert.equal(unit.gatewayContainer?.gatewayId, first.gatewayId, 'its volume still holds this id');
    assert.equal(unit.gateway?.id, first.gatewayId);
    const again = containers.get(name) as FakeContainer;
    assert.equal(envOf(again, 'CUBE_GATEWAY_ID'), first.gatewayId);
    assert.equal(envOf(again, 'CUBE_PORT'), '18751');
    assert.deepEqual(again.body.HostConfig.Binds, [`${name}:/data`]);
  });

  test('deleting the apartment removes its gateway container and link, but not its data volume', async () => {
    const name = first.containerName;
    assert.ok(containers.has(name));
    assert.equal((await api('DELETE', `/api/admin/units/${unitId}`)).status, 200);
    assert.ok(!containers.has(name));
    assert.ok(!calls.some((call) => call.startsWith('DELETE /volumes')));
    const gateways = (await api<{ id: string }[]>('GET', '/api/admin/gateways')).data;
    assert.ok(!gateways.some((gateway) => gateway.id === first.gatewayId));
  });

  test('residents and their sessions can\'t make gateways', async () => {
    const response = await fetch(`${BASE}/api/admin/units/${unitId}/gateway`, { method: 'POST' });
    assert.equal(response.status, 401);
  });
});
