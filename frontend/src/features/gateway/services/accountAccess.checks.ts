/**
 * Behaviour checks for reaching the apartment gateway through the resident's EMS account: the
 * gateway the phone keeps after exchanging a pass, and when it connects, retries and lets go.
 *
 *   npm run check:account
 */

import type { GatewayPass } from '../../../../../shared/contracts/gateway';
import type { ClaimResult } from '../../../types/gateway.types';
import {
  accountGatewayFrom,
  accountLinkView,
  nextAccountStep,
  passUrl,
  removedOnSignOut,
  shouldConnectOnSignIn,
  shouldRetryOnForeground,
  shouldRetryRefused,
  type AccountLink,
} from './accountAccess';
import { endpointAttempts } from './gatewayEndpoints';
import type { StoredGateway } from './gatewayStore.types';

const ID = '0810268a-65a9-4059-a543-0e1daaa8ab51';
const OTHER = '5b0c1f8e-2d7a-4c1b-9e3f-7a6d5c4b3a21';
const RELAY = `https://cube-relay.ems-iot.com/relay/v1/g/${ID}`;
const NOW = 1_767_225_600_000;

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const pass = (url: string | null, id = ID, role: GatewayPass['role'] = 'member'): GatewayPass => ({
  gateway: { id, url },
  pass: 'v1.signed-pass',
  expiresAt: NOW + 5 * 60_000,
  role,
});

const exchanged = (id = ID, role: 'owner' | 'member' = 'member'): ClaimResult => ({
  client: { id: 'client-7', name: 'Parklane on iPhone', role },
  token: 'gw-token',
  pin_key: 'pin-key',
  gateway: { id, name: 'Apartment 4B' },
});

const entry = (id: string, source?: StoredGateway['source']) => ({ id, ...(source ? { source } : {}) });

const SIGNED_IN = { signedIn: true, storeLoaded: true, gatewayCount: 0, triedThisSession: false };
const REFUSED = { gateway: entry(ID, 'account'), refused: true, signedIn: true, retried: new Set<string>() };

const checks: [string, () => void][] = [
  [
    'an exchanged pass becomes an account-issued gateway reached at the pass address, already verified there',
    () =>
      equal(accountGatewayFrom(pass(RELAY), exchanged(), NOW), {
        id: ID,
        name: 'Apartment 4B',
        clientId: 'client-7',
        role: 'member',
        token: 'gw-token',
        pinKey: 'pin-key',
        endpoints: { remote: [RELAY] },
        lastUrl: RELAY,
        verifiedUrls: [RELAY],
        pairedAt: NOW,
        source: 'account',
      }),
  ],
  ['the role kept is the one the gateway gave the token', () => equal(accountGatewayFrom(pass(RELAY, ID, 'member'), exchanged(ID, 'owner'), NOW)?.role, 'owner')],
  [
    'a trailing slash on the pass address is dropped, since API paths are appended to it',
    () => {
      equal(passUrl(pass(`${RELAY}/`)), RELAY);
      equal(accountGatewayFrom(pass(`${RELAY}//`), exchanged(), NOW)?.lastUrl, RELAY);
    },
  ],
  ['a gateway other than the one the backend named is not kept', () => equal(accountGatewayFrom(pass(RELAY), exchanged(OTHER), NOW), null)],
  [
    'the stored address is tried first and without the identity challenge',
    () => {
      const stored = accountGatewayFrom(pass(RELAY), exchanged(), NOW);
      if (!stored) throw new Error('no gateway');
      equal(endpointAttempts(stored).map((attempt) => attempt.url), [RELAY]);
      equal(stored.verifiedUrls.includes(RELAY), true, 'verified');
    },
  ],
  [
    'a pass without an address, or a blank one, means no gateway yet',
    () => {
      equal(nextAccountStep(pass(null), []), { kind: 'no_gateway' }, 'null');
      equal(nextAccountStep(pass('  '), []), { kind: 'no_gateway' }, 'blank');
      equal(accountGatewayFrom(pass(null), exchanged(), NOW), null, 'nothing to keep');
    },
  ],
  ['a pass with an address is exchanged there', () => equal(nextAccountStep(pass(RELAY), []), { kind: 'exchange', url: RELAY })],
  [
    'a gateway this phone paired with a code is kept as it is, not exchanged again',
    () => {
      equal(nextAccountStep(pass(RELAY), [entry(ID, 'pairing')]), { kind: 'already_paired', gatewayId: ID }, 'pairing');
      equal(nextAccountStep(pass(RELAY), [entry(ID)]), { kind: 'already_paired', gatewayId: ID }, 'entry from before source existed');
    },
  ],
  [
    'an earlier account-issued entry for the gateway is exchanged again, replacing it',
    () => equal(nextAccountStep(pass(RELAY), [entry(ID, 'account')]), { kind: 'exchange', url: RELAY }),
  ],
  ['a code-paired gateway elsewhere does not stop the exchange', () => equal(nextAccountStep(pass(RELAY), [entry(OTHER, 'pairing')]), { kind: 'exchange', url: RELAY })],
  ['signed in with no gateway on the phone: connect through the account', () => equal(shouldConnectOnSignIn(SIGNED_IN), true)],
  [
    'not without a session, before the stored gateways are read, or with any gateway on the phone',
    () => {
      equal(shouldConnectOnSignIn({ ...SIGNED_IN, signedIn: false }), false, 'signed out');
      equal(shouldConnectOnSignIn({ ...SIGNED_IN, storeLoaded: false }), false, 'store loading');
      equal(shouldConnectOnSignIn({ ...SIGNED_IN, gatewayCount: 1 }), false, 'a gateway stored');
    },
  ],
  ['only once per sign-in or app start, whatever the outcome', () => equal(shouldConnectOnSignIn({ ...SIGNED_IN, triedThisSession: true }), false)],
  [
    'a connection that got no answer is tried again on returning to the app; an answer stands',
    () => {
      const failed = (code: string): AccountLink => ({ state: 'error', code, message: 'x' });
      const retry = (link: AccountLink, extra: { signedIn?: boolean; gatewayCount?: number } = {}) =>
        shouldRetryOnForeground({ link, signedIn: true, gatewayCount: 0, ...extra });
      equal([retry(failed('network')), retry(failed('timeout'))], [true, true], 'no answer');
      equal([retry(failed('forbidden')), retry(failed('unverified_gateway')), retry({ state: 'no_gateway' }), retry({ state: 'idle' })], [false, false, false, false], 'answered');
      equal(retry(failed('network'), { signedIn: false }), false, 'signed out');
      equal(retry(failed('network'), { gatewayCount: 1 }), false, 'a gateway on the phone');
    },
  ],
  ['a refused account-issued token gets one fresh pass', () => equal(shouldRetryRefused(REFUSED), true)],
  ['and only one: after that the refusal stands', () => equal(shouldRetryRefused({ ...REFUSED, retried: new Set([ID]) }), false)],
  [
    'another gateway’s retry does not use this one’s',
    () => equal(shouldRetryRefused({ ...REFUSED, retried: new Set([OTHER]) }), true),
  ],
  [
    'gateways paired with a code are never re-issued',
    () => {
      equal(shouldRetryRefused({ ...REFUSED, gateway: entry(ID, 'pairing') }), false, 'pairing');
      equal(shouldRetryRefused({ ...REFUSED, gateway: entry(ID) }), false, 'no source');
    },
  ],
  [
    'no retry without a refusal, a session or a gateway',
    () => {
      equal(shouldRetryRefused({ ...REFUSED, refused: false }), false, 'not refused');
      equal(shouldRetryRefused({ ...REFUSED, signedIn: false }), false, 'signed out');
      equal(shouldRetryRefused({ ...REFUSED, gateway: null }), false, 'no gateway');
    },
  ],
  [
    'signing out takes every account-issued gateway off the phone, and only those',
    () =>
      equal(
        removedOnSignOut([entry(ID, 'account'), entry(OTHER, 'pairing'), entry('legacy'), entry('second', 'account')], true).map((gateway) => gateway.id),
        [ID, 'second'],
      ),
  ],
  ['nothing is taken while signed in, or while the session is still being restored', () => equal(removedOnSignOut([entry(ID, 'account')], false), [])],
  [
    'the screen shows connected while the phone holds an account-issued gateway',
    () => {
      equal(accountLinkView({ state: 'idle' }, [entry(OTHER, 'pairing'), entry(ID, 'account')]), { state: 'connected', gatewayId: ID }, 'kept from before');
      equal(accountLinkView({ state: 'idle' }, [entry(OTHER, 'pairing')]), { state: 'idle' }, 'pairing only');
    },
  ],
  [
    'connected to a code-paired gateway stays connected while that gateway is on the phone',
    () => equal(accountLinkView({ state: 'connected', gatewayId: OTHER }, [entry(OTHER, 'pairing')]), { state: 'connected', gatewayId: OTHER }),
  ],
  [
    'a gateway forgotten since is no longer shown as connected',
    () => equal(accountLinkView({ state: 'connected', gatewayId: ID }, []), { state: 'idle' }),
  ],
  [
    'connecting, no gateway and errors are shown as they are',
    () => {
      const shown: AccountLink[] = [{ state: 'connecting' }, { state: 'no_gateway' }, { state: 'error', code: 'rate_limited', message: 'Slow down.' }];
      shown.forEach((link) => equal(accountLinkView(link, [entry(ID, 'account')]), link, link.state));
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
