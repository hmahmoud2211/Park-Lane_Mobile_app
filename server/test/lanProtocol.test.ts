import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { decodeTxt, decrypt, encrypt, powerOf, sendSwitch } from '../src/sonoff/lanProtocol.ts';

const KEY = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

test('encrypt and decrypt round-trip with the device key', () => {
  const sealed = encrypt({ switch: 'on' }, KEY);
  assert.deepEqual(decrypt(sealed.data, sealed.iv, KEY), { switch: 'on' });
});

test('decrypt rejects the wrong key', () => {
  const sealed = encrypt({ switch: 'on', startup: 'off', pulse: 'off' }, KEY);
  assert.throws(() => decrypt(sealed.data, sealed.iv, 'another-key-entirely'));
});

test('decodeTxt joins data1..data4 and verifies the key', () => {
  const sealed = encrypt({ switch: 'off', fwVersion: '3.5.0' }, KEY);
  const half = Math.ceil(sealed.data.length / 2);
  const txt = {
    id: '1000abcdef',
    type: 'plug',
    encrypt: 'true',
    iv: sealed.iv,
    data1: sealed.data.slice(0, half),
    data2: sealed.data.slice(half),
  };
  const good = decodeTxt(txt, KEY);
  assert.equal(good.keyVerified, true);
  assert.equal(powerOf(good.params), 'off');

  const bad = decodeTxt(txt, 'not-the-key-at-all');
  assert.equal(bad.keyVerified, false);
  assert.equal(bad.params, null);

  assert.equal(decodeTxt(txt).keyVerified, null, 'no key, nothing checked');
});

test('decodeTxt reads plain (DIY-mode) announcements without a key', () => {
  const state = decodeTxt({ id: '1000abcdef', type: 'diy_plug', data1: '{"switch":"on"}' });
  assert.equal(state.encrypted, false);
  assert.equal(state.keyVerified, null);
  assert.equal(powerOf(state.params), 'on');
});

test('powerOf ignores multi-channel state', () => {
  assert.equal(powerOf({ switches: [{ switch: 'on', outlet: 0 }] }), null);
});

/** A stand-in plug: decrypts the command with the key, as the firmware would. */
async function fakePlug(handler: (data: unknown) => object) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const data = body.encrypt ? decrypt(body.data, body.iv, KEY) : body.data;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handler({ path: req.url, deviceid: body.deviceid, data })));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

test('sendSwitch posts an encrypted switch command the plug can read', async () => {
  let received: unknown;
  const plug = await fakePlug((request) => {
    received = request;
    return { seq: 1, error: 0 };
  });
  try {
    const result = await sendSwitch(
      { host: '127.0.0.1', port: plug.port, deviceId: '1000abcdef', deviceKey: KEY, encrypted: true },
      'on',
    );
    assert.equal(result, 'ok');
    assert.deepEqual(received, { path: '/zeroconf/switch', deviceid: '1000abcdef', data: { switch: 'on' } });
  } finally {
    plug.server.close();
  }
});

test('sendSwitch reports a refusal and an unreachable plug as such', async () => {
  const plug = await fakePlug(() => ({ seq: 1, error: 400 }));
  try {
    const target = { host: '127.0.0.1', port: plug.port, deviceId: '1000abcdef', deviceKey: KEY, encrypted: true };
    assert.equal(await sendSwitch(target, 'off'), 'rejected');
  } finally {
    plug.server.close();
  }
  const closed = { host: '127.0.0.1', port: plug.port, deviceId: '1000abcdef', deviceKey: KEY, encrypted: true };
  assert.equal(await sendSwitch(closed, 'off'), 'unreachable');
});
