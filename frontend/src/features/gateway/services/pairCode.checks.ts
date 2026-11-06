/**
 * Behaviour checks for reading a gateway's pairing QR code, in the exact forms gateways print.
 *
 *   npm run check:pairing
 */

import { isRemoteGatewayUrl, parsePairPayload, type PairPayload } from './pairCode';

function expectPayload(data: string, expected: PairPayload | null) {
  const actual = JSON.stringify(parsePairPayload(data));
  if (actual !== JSON.stringify(expected)) {
    throw new Error(`${data}\n        got ${actual}`);
  }
}

const noAddress = (gatewayId: string | null, code: string): PairPayload => ({ baseUrl: null, gatewayId, code, remote: false });

const checks: [string, () => void][] = [
  [
    'a home gateway gives its address and code',
    () => expectPayload('cubegw://pair?host=192.168.1.20:8686&id=gw1&code=W4AT-GBXP', { baseUrl: 'http://192.168.1.20:8686', gatewayId: 'gw1', code: 'W4AT-GBXP', remote: false }),
  ],
  [
    'a gateway on CUBE\u2019s server gives its relay address',
    () =>
      expectPayload('cubegw://pair?url=https://cube-relay.ems-iot.com/relay/v1/g/gw1&id=gw1&code=W4AT-GBXP', {
        baseUrl: 'https://cube-relay.ems-iot.com/relay/v1/g/gw1',
        gatewayId: 'gw1',
        code: 'W4AT-GBXP',
        remote: true,
      }),
  ],
  ['a code with no address keeps the setup code', () => expectPayload('cubegw://pair?id=gw1&code=W4AT-GBXP', noAddress('gw1', 'W4AT-GBXP'))],
  ['a blank address counts as no address', () => expectPayload('cubegw://pair?host=&id=gw1&code=W4AT-GBXP', noAddress('gw1', 'W4AT-GBXP'))],
  ['a loopback address counts as no address', () => expectPayload('cubegw://pair?host=127.0.0.1:18701&id=gw1&code=W4AT-GBXP', noAddress('gw1', 'W4AT-GBXP'))],
  ['localhost counts as no address', () => expectPayload('cubegw://pair?host=localhost:8686&id=gw1&code=W4AT-GBXP', noAddress('gw1', 'W4AT-GBXP'))],
  ['a pairing code needs an address or a code', () => expectPayload('cubegw://pair?id=gw1', null)],
  ['other QR codes are refused', () => expectPayload('http://thinq.link/QR1?s=1&m=2', null)],
  ['a relay address must be https', () => expectPayload('cubegw://pair?url=http://relay.test/relay/v1/g/gw1&code=W4AT-GBXP', null)],
  ['an address with stray characters is refused', () => expectPayload('cubegw://pair?host=192.168.1.20/evil&code=W4AT-GBXP', null)],
  [
    'only https counts as a remote gateway',
    () => {
      if (!isRemoteGatewayUrl('https://cube-relay.ems-iot.com/relay/v1/g/gw1') || isRemoteGatewayUrl('http://192.168.1.20:8686')) {
        throw new Error('wrong answer');
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
