import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { getPlug, plugEvents, setPlugPower, startSonoffCloud, stopSonoffCloud } from '../src/sonoff/cloud.ts';

/**
 * SONOFF plugs connecting to the backend instead of eWeLink's cloud: a
 * stand-in plug asks /dispatch/device, opens /api/ws, registers and reports
 * its state the way SonOTA documents real plugs doing, and acknowledges
 * commands (or, for one test, stays silent). Plain HTTP; production uses TLS.
 */

async function freePort(): Promise<number> {
  const probe = createHttpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const port = await freePort();
const DEVICE_ID = '1000abcdef';

/** A plug's side of the WebSocket: masked text frames out, the server's unmasked frames in. */
class StandInPlug {
  readonly received: Record<string, unknown>[] = [];
  /** When false, commands from the server go unanswered. */
  acknowledge = true;
  private buffer = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private readonly socket: Socket;

  private constructor(socket: Socket) {
    this.socket = socket;
  }

  static async open(): Promise<StandInPlug> {
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      [
        'GET /api/ws HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
    const plug = new StandInPlug(socket);
    await new Promise<void>((resolve) => {
      let head = '';
      const onData = (chunk: Buffer) => {
        head += chunk.toString('latin1');
        const end = head.indexOf('\r\n\r\n');
        if (end !== -1) {
          socket.removeListener('data', onData);
          assert.match(head, /^HTTP\/1\.1 101/);
          socket.on('data', (data: Buffer) => plug.receive(data));
          const rest = Buffer.from(head.slice(end + 4), 'latin1');
          if (rest.length) {
            plug.receive(rest);
          }
          resolve();
        }
      };
      socket.on('data', onData);
    });
    return plug;
  }

  send(message: Record<string, unknown>) {
    const payload = Buffer.from(JSON.stringify(message));
    const mask = randomBytes(4);
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    const header =
      payload.length < 126
        ? Buffer.from([0x81, 0x80 | payload.length])
        : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      }
      if (this.buffer.length < offset + length) {
        return;
      }
      const opcode = this.buffer[0] & 0x0f;
      const payload = this.buffer.subarray(offset, offset + length).toString('utf8');
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode !== 0x1) {
        continue;
      }
      const message = JSON.parse(payload) as Record<string, unknown>;
      this.received.push(message);
      if (message.action === 'update' && this.acknowledge) {
        this.send({ error: 0, deviceid: DEVICE_ID, apikey: 'k', sequence: message.sequence });
      }
      for (const wake of this.waiters.splice(0)) {
        wake();
      }
    }
  }

  /** The first message (from the start, or after `since`) that matches. */
  async next(match: (message: Record<string, unknown>) => boolean, since = 0): Promise<Record<string, unknown>> {
    for (;;) {
      const found = this.received.slice(since).find(match);
      if (found) {
        return found;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  close() {
    this.socket.destroy();
  }
}

describe('SONOFF plugs connecting to the backend', () => {
  let plug: StandInPlug;

  before(async () => {
    await startSonoffCloud({ port, host: '127.0.0.1', tls: null, idleTimeoutMs: 10_000, commandTimeoutMs: 300 });
  });

  after(async () => {
    plug?.close();
    await stopSonoffCloud();
  });

  test('/dispatch/device sends the plug to this server', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/dispatch/device`, {
      method: 'POST',
      body: JSON.stringify({ accept: 'ws', version: 2, deviceid: DEVICE_ID, apikey: 'k', model: 'PSF-BFB-GL', romVersion: '3.5.0' }),
    });
    assert.deepEqual(await response.json(), { error: 0, reason: 'ok', IP: '127.0.0.1', port });
  });

  test('a plug registers, gets the time, and reports its state', async () => {
    plug = await StandInPlug.open();
    plug.send({ action: 'register', deviceid: DEVICE_ID, apikey: 'k', model: 'PSF-BFB-GL', romVersion: '3.5.0', ts: 1 });
    const registered = await plug.next((message) => (message.config as { hb?: number } | undefined)?.hb === 1);
    assert.equal(registered.error, 0);
    assert.equal(registered.deviceid, DEVICE_ID);

    plug.send({ action: 'date', deviceid: DEVICE_ID, apikey: 'k' });
    const date = await plug.next((message) => typeof message.date === 'string');
    assert.ok(!Number.isNaN(Date.parse(String(date.date))));

    plug.send({ action: 'update', deviceid: DEVICE_ID, apikey: 'k', params: { switch: 'on', startup: 'off' } });
    // Proving the command channel re-sends the state the plug reported.
    const check = await plug.next((message) => message.action === 'update');
    assert.deepEqual(check.params, { switch: 'on' });
    assert.deepEqual(getPlug(DEVICE_ID), { ...getPlug(DEVICE_ID), online: true, power: 'on', model: 'PSF-BFB-GL', romVersion: '3.5.0' });
  });

  test('a switch command resolves once the plug acknowledges it', async () => {
    const since = plug.received.length;
    const changed = new Promise((resolve) => plugEvents.once('change', resolve));
    await setPlugPower(DEVICE_ID, 'off');
    const command = await plug.next((message) => message.action === 'update', since);
    assert.deepEqual(command.params, { switch: 'off' });
    assert.equal(await changed, DEVICE_ID);
    assert.equal(getPlug(DEVICE_ID)?.power, 'off');
  });

  test('an unacknowledged command times out and keeps the last state', async () => {
    plug.acknowledge = false;
    await assert.rejects(setPlugPower(DEVICE_ID, 'on'), { code: 'command_timeout' });
    assert.equal(getPlug(DEVICE_ID)?.power, 'off');
    plug.acknowledge = true;
  });

  test('a disconnected plug is offline and refuses commands', async () => {
    const changed = new Promise((resolve) => plugEvents.once('change', resolve));
    plug.close();
    assert.equal(await changed, DEVICE_ID);
    assert.equal(getPlug(DEVICE_ID)?.online, false);
    await assert.rejects(setPlugPower(DEVICE_ID, 'on'), { code: 'device_offline' });
  });
});
