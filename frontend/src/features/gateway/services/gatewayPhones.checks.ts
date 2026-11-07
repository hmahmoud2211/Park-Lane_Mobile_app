/**
 * Behaviour checks for the owner's list of a gateway's phones: which are shown and in what
 * order, how each is labelled, and which can be removed.
 *
 *   npm run check:phones
 */

import type { GatewayClient } from '../../../types/gateway.types';
import { phoneAge, phoneOrigin, phoneRows, type PhoneRow } from './gatewayPhones';

const NOW = 1_767_225_600_000;
const T = NOW / 1000;
const ME = 'user-mona';

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const client = (id: string, fields: Partial<GatewayClient> = {}): GatewayClient => ({
  id,
  name: `Phone ${id}`,
  role: 'member',
  created_at: T - 30 * 86_400,
  last_seen: null,
  revoked: false,
  account_id: ME,
  ...fields,
});

const rows = (clients: GatewayClient[], ownClientId = 'own', myAccountId: string | null = ME) => phoneRows(clients, { ownClientId, myAccountId, nowMs: NOW });
const ids = (list: PhoneRow[]) => list.map((row) => row.id);

const checks: [string, () => void][] = [
  ['revoked phones are left out', () => equal(ids(rows([client('a', { revoked: true }), client('b')])), ['b'])],
  [
    'most recently used first, with fractional seconds compared as they are',
    () => equal(ids(rows([client('old', { last_seen: T - 3600 }), client('new', { last_seen: T - 5.25 }), client('mid', { last_seen: T - 5.5 })])), ['new', 'mid', 'old']),
  ],
  [
    'phones that never used their token come after the others, newest added first',
    () =>
      equal(
        ids(rows([client('never-old', { created_at: T - 900 }), client('used', { last_seen: T - 86_400 * 20 }), client('never-new', { created_at: T - 60 })])),
        ['used', 'never-new', 'never-old'],
      ),
  ],
  [
    'ties fall back to when added, then the name',
    () =>
      equal(
        ids(rows([client('b', { name: 'Bravo', last_seen: T - 10, created_at: T - 100 }), client('a', { name: 'Alpha', last_seen: T - 10, created_at: T - 100 }), client('c', { last_seen: T - 10, created_at: T - 50 })])),
        ['c', 'a', 'b'],
      ),
  ],
  ['the list it was given is not reordered', () => {
    const given = [client('x', { last_seen: T - 100 }), client('y', { last_seen: T - 1 })];
    rows(given);
    equal(given.map((entry) => entry.id), ['x', 'y']);
  }],
  [
    'this phone is marked and is the only one without Remove',
    () => {
      const list = rows([client('own', { last_seen: T - 1 }), client('lost', { last_seen: T - 86_400 * 3 }), client('installer', { account_id: null })]);
      equal(list.map((row) => [row.id, row.thisPhone, row.removable]), [['own', true, false], ['lost', false, true], ['installer', false, true]]);
    },
  ],
  [
    'an owner’s other phones and other owners can be removed too',
    () => equal(rows([client('other-owner', { role: 'owner' })])[0].removable, true),
  ],
  [
    'whose phone: this resident’s account, another resident’s, or an installer’s code',
    () => {
      equal(phoneOrigin(ME, ME), 'mine', 'mine');
      equal(phoneOrigin('user-karim', ME), 'resident', 'another resident');
      equal(phoneOrigin(null, ME), 'installer', 'null');
      equal(phoneOrigin(undefined, ME), 'installer', 'older gateway without the field');
      equal(phoneOrigin('', ME), 'installer', 'blank');
    },
  ],
  ['without the signed-in user, an account phone is a resident’s, never assumed to be this one’s', () => equal(phoneOrigin(ME, null), 'resident')],
  [
    'last used: just now under a minute, then minutes, hours and days',
    () => {
      equal(phoneAge(T - 59, NOW), { unit: 'now' }, '59 s');
      equal(phoneAge(T - 60, NOW), { unit: 'minutes', count: 1 }, '60 s');
      equal(phoneAge(T - 3599, NOW), { unit: 'minutes', count: 59 }, '59 min');
      equal(phoneAge(T - 3600, NOW), { unit: 'hours', count: 1 }, '1 h');
      equal(phoneAge(T - 86_399, NOW), { unit: 'hours', count: 23 }, '23 h');
      equal(phoneAge(T - 86_400, NOW), { unit: 'days', count: 1 }, '1 day');
      equal(phoneAge(T - 6.9 * 86_400, NOW), { unit: 'days', count: 6 }, '6.9 days');
    },
  ],
  ['a week or more ago is shown as the date', () => equal(phoneAge(T - 7 * 86_400 - 0.5, NOW), { unit: 'date', at: NOW - 7 * 86_400_000 - 500 })],
  ['a time ahead of the phone’s clock reads as just now', () => equal(phoneAge(T + 300, NOW), { unit: 'now' })],
  [
    'a phone that never used its token has no last use, only when it was added',
    () => {
      const [row] = rows([client('fresh', { created_at: T - 120 })]);
      equal([row.lastUsed, row.added], [null, { unit: 'minutes', count: 2 }]);
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
