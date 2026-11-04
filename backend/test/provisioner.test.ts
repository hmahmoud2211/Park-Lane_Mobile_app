import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { demoHome, FakeHa } from './fakeHa.ts';

/**
 * Provisioning a unit end to end against a stand-in Docker Engine API (on a
 * socket, as the real one) and a stand-in Home Assistant that the "container"
 * publishes: network, image, container, onboarding, token, then online.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'ems-provision-'));
const socketPath =
  process.platform === 'win32' ? `\\\\.\\pipe\\parklane-docker-${randomBytes(4).toString('hex')}` : join(dataDir, 'docker.sock');

Object.assign(process.env, {
  DATA_DIR: dataDir,
  ADMIN_API_KEY: 'admin',
  DOCKER_SOCKET: socketPath,
  HA_PUBLISH_LOCAL_PORTS: '1',
  HA_IMAGE: 'ghcr.io/home-assistant/home-assistant:2026.11.0',
  HA_OAUTH_CREDENTIALS: JSON.stringify({ smartthings: { clientId: 'st-client', clientSecret: 'st-secret' } }),
});

const { createUser } = await import('../src/ems/auth.ts');
const { getHubForUnit, runtimeForUser, stopHubs } = await import('../src/ha/hubs.ts');
const { deprovisionUnit, provisionUnit, provisioningDone } = await import('../src/ha/provisioner.ts');
const { addMember, createUnit } = await import('../src/ha/units.ts');

const ha = new FakeHa(demoHome(), 'unused-token-000000000');
const requests: string[] = [];
const containers = new Map<string, { body: Record<string, unknown>; running: boolean }>();
let networkExists = false;
let docker: Server;

function dockerApi(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://docker');
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push(`${req.method} ${url.pathname}`);
    const json = (status: number, payload: unknown = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const container = /^\/containers\/([^/]+)(\/start|\/json)?$/.exec(url.pathname);
    if (url.pathname === '/networks/parklane-ha') return json(networkExists ? 200 : 404, { message: 'network not found' });
    if (url.pathname === '/networks/create') {
      networkExists = true;
      return json(201, { Id: 'net' });
    }
    if (url.pathname.startsWith('/images/') && url.pathname.endsWith('/json')) return json(404, { message: 'no such image' });
    if (url.pathname === '/images/create') return json(200, { status: 'Downloaded newer image' });
    if (url.pathname === '/containers/create') {
      containers.set(url.searchParams.get('name') as string, { body, running: false });
      return json(201, { Id: 'container' });
    }
    if (container) {
      const found = containers.get(container[1]);
      if (!found) return json(404, { message: 'no such container' });
      if (container[2] === '/start') {
        found.running = true;
        return json(204);
      }
      if (container[2] === '/json') {
        return json(200, { NetworkSettings: { Ports: { '8123/tcp': [{ HostIp: '127.0.0.1', HostPort: String(ha.port) }] } } });
      }
      if (req.method === 'DELETE') {
        containers.delete(container[1]);
        return json(204);
      }
    }
    return json(404, { message: `unexpected ${req.method} ${url.pathname}` });
  });
}

before(async () => {
  await ha.listen();
  docker = createServer(dockerApi);
  await new Promise<void>((resolve) => docker.listen(socketPath, resolve));
});

after(async () => {
  stopHubs();
  await ha.close();
  docker.closeAllConnections();
  await new Promise((resolve) => docker.close(resolve));
});

describe('provisioning a unit', () => {
  test('creates the network, pulls the image, starts the container, onboards HA and connects', async () => {
    const user = await createUser('provision@example.com', 'correct horse battery', 'Resident');
    const unit = createUnit('Tower C · 0907', 'Tower C');
    addMember(unit.id, 'provision@example.com', 'owner');

    const started = provisionUnit(unit.id, unit.name);
    assert.equal(started.status, 'provisioning');
    await provisioningDone(unit.id);

    const hub = getHubForUnit(unit.id);
    assert.equal(hub?.lastError, null, hub?.lastError ?? '');
    assert.equal(hub?.baseUrl, `http://127.0.0.1:${ha.port}`);
    assert.ok(ha.onboarded, 'the admin user was created');
    assert.deepEqual(requests.slice(0, 6), [
      'GET /networks/parklane-ha',
      'POST /networks/create',
      `GET /images/${encodeURIComponent('ghcr.io/home-assistant/home-assistant:2026.11.0')}/json`,
      'POST /images/create',
      `GET /containers/${hub?.containerName}/json`,
      'POST /containers/create',
    ]);

    const created = containers.get(hub?.containerName as string)?.body as { Image: string; HostConfig: Record<string, unknown> };
    assert.equal(created.Image, 'ghcr.io/home-assistant/home-assistant:2026.11.0');
    assert.equal((created.HostConfig.RestartPolicy as { Name: string }).Name, 'unless-stopped');
    assert.equal(created.HostConfig.NetworkMode, 'parklane-ha');
    assert.match(String((created.HostConfig.Binds as string[])[0]), /:\/config$/);

    const yaml = readFileSync(join(dataDir, 'ha', unit.id, 'configuration.yaml'), 'utf8');
    assert.match(yaml, /application_credentials:/);
    assert.doesNotMatch(yaml, /default_config|zeroconf|bluetooth/);

    // Connected with the long-lived token, not the short onboarding one.
    const runtime = runtimeForUser(user.id);
    for (let tries = 0; runtime.status !== 'online' && tries < 80; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(runtime.status, 'online');
    assert.ok(runtime.listDevices().some((device) => device.id === 'dev-light'));
    assert.ok([...ha.tokens].some((token) => token.startsWith('llat-')));
  });

  test('removing the unit removes its container but keeps its /config', async () => {
    // The stand-in "container" is the same fake HA each time; make it fresh again.
    ha.onboarded = false;
    const unit = createUnit('Tower C · 0101', null);
    provisionUnit(unit.id, unit.name);
    await provisioningDone(unit.id);
    assert.equal(getHubForUnit(unit.id)?.lastError, null);
    const name = getHubForUnit(unit.id)?.containerName as string;
    assert.ok(containers.has(name));
    await deprovisionUnit(unit.id);
    assert.ok(!containers.has(name));
    assert.ok(existsSync(join(dataDir, 'ha', unit.id, 'configuration.yaml')));
  });
});
