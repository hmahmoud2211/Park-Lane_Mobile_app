import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EWELINK_SERVICE, buildQuery, deviceIdOf, parseRecords } from '../src/sonoff/mdns.ts';

/** Builds a response the way an eWeLink device sends one, with name compression. */
function announcement(): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // response, authoritative
  header.writeUInt16BE(1, 6); // one answer
  header.writeUInt16BE(3, 10); // three additional records
  parts.push(header);
  let length = 12;
  const push = (buffer: Buffer) => {
    parts.push(buffer);
    length += buffer.length;
  };
  const name = (labels: string[]) =>
    Buffer.concat([...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])]);
  const pointer = (offset: number) => Buffer.from([0xc0 | (offset >> 8), offset & 0xff]);
  const record = (type: number, ttl: number, rdata: Buffer) => {
    const fixed = Buffer.alloc(10);
    fixed.writeUInt16BE(type, 0);
    fixed.writeUInt16BE(0x8001, 2);
    fixed.writeUInt32BE(ttl, 4);
    fixed.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([fixed, rdata]);
  };

  // PTR _ewelink._tcp.local -> eWeLink_1000abcdef._ewelink._tcp.local
  const serviceAt = length;
  push(name(['_ewelink', '_tcp', 'local']));
  const instanceRdata = Buffer.concat([name(['eWeLink_1000abcdef']).subarray(0, -1), pointer(serviceAt)]);
  const ptrAt = length + 10; // the instance name inside the PTR's rdata
  push(record(12, 120, instanceRdata));

  // SRV for the instance (by pointer) -> host eWeLink_1000abcdef.local:8081
  push(pointer(ptrAt));
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(8081, 4);
  const hostRdata = Buffer.concat([srv, name(['eWeLink_1000abcdef', 'local'])]);
  const hostAt = length + 10 + 6;
  push(record(33, 120, hostRdata));

  // TXT
  push(pointer(ptrAt));
  const entries = ['txtvers=1', 'id=1000abcdef', 'type=plug', 'apivers=1', 'seq=7', 'encrypt=true', 'iv=AAAA', 'data1=BBBB'];
  push(record(16, 4500, Buffer.concat(entries.map((entry) => Buffer.concat([Buffer.from([entry.length]), Buffer.from(entry)])))));

  // A for the host
  push(pointer(hostAt));
  push(record(1, 120, Buffer.from([192, 168, 1, 77])));

  return Buffer.concat(parts);
}

test('parseRecords reads PTR, SRV, TXT and A with compressed names', () => {
  const records = parseRecords(announcement());
  const byType = Object.fromEntries(records.map((entry) => [entry.type, entry]));

  assert.equal(byType[12].name, EWELINK_SERVICE);
  assert.equal(byType[12].target, `eWeLink_1000abcdef.${EWELINK_SERVICE}`);
  assert.equal(byType[33].port, 8081);
  assert.equal(byType[33].target, 'eWeLink_1000abcdef.local');
  assert.equal(byType[16].txt?.id, '1000abcdef');
  assert.equal(byType[16].txt?.encrypt, 'true');
  assert.equal(byType[1].address, '192.168.1.77');
});

test('parseRecords ignores queries', () => {
  assert.deepEqual(parseRecords(buildQuery(EWELINK_SERVICE, false)), []);
});

test('buildQuery asks for PTR, with the unicast bit only when asked', () => {
  const multicast = buildQuery(EWELINK_SERVICE, false);
  const unicast = buildQuery(EWELINK_SERVICE, true);
  assert.equal(multicast.readUInt16BE(multicast.length - 4), 12);
  assert.equal(multicast.readUInt16BE(multicast.length - 2), 0x0001);
  assert.equal(unicast.readUInt16BE(unicast.length - 2), 0x8001);
});

test('deviceIdOf prefers the TXT id, then the instance name', () => {
  assert.equal(deviceIdOf('ewelink_1000abcdef._ewelink._tcp.local'), '1000abcdef');
  assert.equal(deviceIdOf('something-else._ewelink._tcp.local', { id: '1000FFFFFF' }), '1000ffffff');
  assert.equal(deviceIdOf('ihost-1001._ewelink._tcp.local'), null);
});
