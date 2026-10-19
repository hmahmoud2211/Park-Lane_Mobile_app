import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// The store reads DATA_DIR when first imported, so point it at a scratch folder first.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'parklane-backend-'));

const { handleDirective } = await import('../src/sonoff/bridge.ts');
const { decrypt } = await import('../src/sonoff/lanProtocol.ts');
const store = await import('../src/sonoff/store.ts');

const KEY = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const received: unknown[] = [];
const plug = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    received.push(decrypt(body.data, body.iv, KEY));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"seq":1,"error":0}');
  });
});

before(async () => {
  await new Promise<void>((resolve) => plug.listen(0, '127.0.0.1', resolve));
  await store.upsertPlug({
    deviceId: '1000abcdef',
    deviceKey: KEY,
    name: 'Test Plug',
    cubeSerial: 'cube-serial-1',
    thirdSerial: 'sonoff-1000abcdef',
    host: '127.0.0.1',
    port: (plug.address() as AddressInfo).port,
    encrypted: true,
    power: 'off',
    online: true,
    missedRounds: 0,
    registeredAt: new Date(0).toISOString(),
  });
});

after(() => plug.close());

const directive = (name: string, powerState?: string, third = 'sonoff-1000abcdef') => ({
  directive: {
    header: { name, message_id: 'm-1', version: '1' },
    endpoint: { serial_number: third === 'sonoff-1000abcdef' ? 'cube-serial-1' : 'cube-serial-9', third_serial_number: third },
    payload: powerState ? { state: { power: { powerState } } } : {},
  },
});

test('UpdateDeviceStates switches the plug over the LAN and answers the hub', async () => {
  const answer = (await handleDirective(directive('UpdateDeviceStates', 'on') as never)) as {
    event: { header: { name: string; message_id: string } };
  };
  assert.equal(answer.event.header.name, 'UpdateDeviceStatesResponse');
  assert.equal(answer.event.header.message_id, 'm-1');
  assert.deepEqual(received.at(-1), { switch: 'on' });
  assert.equal((await store.findPlug({ deviceId: '1000abcdef' }))?.power, 'on');
});

test('toggle flips the last known state', async () => {
  await handleDirective(directive('UpdateDeviceStates', 'toggle') as never);
  assert.deepEqual(received.at(-1), { switch: 'off' });
});

test('QueryDeviceStates answers from the last known state', async () => {
  const answer = (await handleDirective(directive('QueryDeviceStates') as never)) as {
    event: { payload: { state: { power: { powerState: string } } } };
  };
  assert.equal(answer.event.payload.state.power.powerState, 'off');
});

test('an unknown plug or directive is refused, not guessed', async () => {
  const unknown = (await handleDirective(directive('UpdateDeviceStates', 'on', 'nope') as never)) as {
    event: { header: { name: string }; payload: { type: string } };
  };
  assert.equal(unknown.event.header.name, 'ErrorResponse');
  assert.equal(unknown.event.payload.type, 'NO_SUCH_ENDPOINT');

  const bad = (await handleDirective(directive('UpdateDeviceStates', 'dim') as never)) as {
    event: { payload: { type: string } };
  };
  assert.equal(bad.event.payload.type, 'INVALID_DIRECTIVE');
});

test('a plug that does not answer is reported unreachable', async () => {
  await store.updatePlug('1000abcdef', { port: 1 });
  const answer = (await handleDirective(directive('UpdateDeviceStates', 'on') as never)) as {
    event: { payload: { type: string } };
  };
  assert.equal(answer.event.payload.type, 'ENDPOINT_UNREACHABLE');
});
