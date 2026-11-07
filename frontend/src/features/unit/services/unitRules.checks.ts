/**
 * Behaviour checks for the apartment's members and invite codes: how a typed code is shaped,
 * who an owner can remove, and the message an owner sends.
 *
 *   npm run check:unit
 */

import type { MyUnit, UnitMember } from '../types';
import { formatCodeInput, inviteMessage, inviteValidity, isCodeComplete, memberRows } from './unitRules';

const NOW = 1_767_225_600_000;
const HOUR = 3_600_000;

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const member = (userId: string, fields: Partial<UnitMember> = {}): UnitMember => ({
  userId,
  name: userId,
  email: null,
  role: 'member',
  you: false,
  since: '2026-11-01T10:00:00.000Z',
  ...fields,
});

const unit = (role: MyUnit['role'], members: UnitMember[]): MyUnit => ({ unit: { id: 'u-4b', name: 'Apartment 4B', building: 'Tower A' }, role, members });

const FAMILY = [
  member('karim', { name: 'Karim', role: 'owner', email: 'karim@parklane.test' }),
  member('lina', { name: 'Lina' }),
  member('mona', { name: 'Mona', role: 'owner', you: true, email: 'mona@parklane.test' }),
  member('adam', { name: 'Adam' }),
];

const checks: [string, () => void][] = [
  [
    'a typed code is put in capitals with the dash after four characters',
    () => {
      equal(formatCodeInput('k7q4'), 'K7Q4', 'four');
      equal(formatCodeInput('k7q49'), 'K7Q4-9', 'five');
      equal(formatCodeInput('k7q49mxd'), 'K7Q4-9MXD', 'eight');
    },
  ],
  [
    'pasted codes with spaces, dashes or other marks come out the same',
    () => ['K7Q4-9MXD', ' k7q4 9mxd ', 'K7Q4–9MXD', 'k7q4_9m.xd', 'K7Q49MXD'].forEach((text) => equal(formatCodeInput(text), 'K7Q4-9MXD', text)),
  ],
  ['deleting back past the dash takes the dash away', () => equal(formatCodeInput('K7Q4-'), 'K7Q4')],
  ['nothing beyond eight characters is kept', () => equal(formatCodeInput('K7Q4-9MXD-EXTRA'), 'K7Q4-9MXD')],
  [
    'only a full eight characters is worth sending',
    () => {
      equal(isCodeComplete('K7Q4-9MX'), false, 'seven');
      equal(isCodeComplete('k7q4 9mxd'), true, 'eight, typed loosely');
      equal(isCodeComplete(''), false, 'empty');
    },
  ],
  [
    'members are listed you first, then owners, then members, by name',
    () => equal(memberRows(unit('owner', FAMILY)).map((row) => row.userId), ['mona', 'karim', 'adam', 'lina']),
  ],
  [
    'an owner can remove everyone but themselves, other owners included',
    () => equal(memberRows(unit('owner', FAMILY)).map((row) => [row.userId, row.removable]), [['mona', false], ['karim', true], ['adam', true], ['lina', true]]),
  ],
  [
    'a member can remove nobody',
    () => {
      const asMember = FAMILY.map((entry) => ({ ...entry, you: entry.userId === 'lina' }));
      equal(memberRows(unit('member', asMember)).some((row) => row.removable), false);
    },
  ],
  ['the members it was given are not reordered', () => {
    const given = [...FAMILY];
    memberRows(unit('owner', given));
    equal(given.map((entry) => entry.userId), ['karim', 'lina', 'mona', 'adam']);
  }],
  [
    'the message says where to go and what to type, with how long the code works',
    () =>
      equal(
        inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW + 24 * HOUR }, NOW + 400, 'Parklane'),
        'Join our apartment in the Parklane app: sign in, then enter code K7Q4-9MXD (valid 24 hours)',
      ),
  ],
  [
    'later on it says what is left, never more',
    () => {
      equal(inviteValidity(NOW + 23.6 * HOUR, NOW), { unit: 'hours', count: 23 }, '23.6 h');
      equal(inviteValidity(NOW + HOUR, NOW), { unit: 'hours', count: 1 }, '1 h');
      equal(inviteValidity(NOW + 59 * 60_000 + 30_000, NOW), { unit: 'hours', count: 1 }, 'a round trip short of an hour');
      equal(inviteValidity(NOW + 40 * 60_000, NOW), { unit: 'minutes', count: 40 }, '40 min');
      equal(inviteValidity(NOW + 20_000, NOW), { unit: 'minutes', count: 1 }, 'seconds left');
    },
  ],
  [
    'singular and plural read right',
    () => {
      equal(inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW + HOUR }, NOW, 'Parklane')?.endsWith('(valid 1 hour)'), true, '1 hour');
      equal(inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW + 60_000 }, NOW, 'Parklane')?.endsWith('(valid 1 minute)'), true, '1 minute');
      equal(inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW + 5 * 60_000 }, NOW, 'Parklane')?.endsWith('(valid 5 minutes)'), true, '5 minutes');
    },
  ],
  [
    'an expired code has nothing to send',
    () => {
      equal(inviteValidity(NOW, NOW), null, 'at expiry');
      equal(inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW - 1 }, NOW), null, 'after');
    },
  ],
  ['the app is named as the brand names it', () => equal(inviteMessage({ code: 'K7Q4-9MXD', expiresAt: NOW + 24 * HOUR }, NOW)?.includes('in the Parklane app'), true)],
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
