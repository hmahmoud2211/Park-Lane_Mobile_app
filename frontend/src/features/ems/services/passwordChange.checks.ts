/**
 * Behaviour checks for choosing one's own password after a temporary one: the rules said
 * before sending, when the step is needed, and how a refusal is worded.
 *
 *   npm run check:password
 */

import { MIN_PASSWORD_LENGTH, hasProblems, needsPasswordChange, passwordChangeFailure, passwordProblems, routeAfterSignIn, type PasswordFields } from './passwordChange';

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const GOOD: PasswordFields = { current: 'Temp-4821x', next: 'my own garden 77', confirm: 'my own garden 77', email: 'mona@parklane.test' };
const problems = (fields: Partial<PasswordFields>) => passwordProblems({ ...GOOD, ...fields });

const checks: [string, () => void][] = [
  ['a good new password, confirmed, has no problems', () => equal([problems({}), hasProblems(problems({}))], [{}, false])],
  ['every field is required', () => equal(problems({ current: '', next: '', confirm: '' }), { current: 'required', next: 'required', confirm: 'required' })],
  [
    `the new password needs at least ${MIN_PASSWORD_LENGTH} characters`,
    () => {
      equal(problems({ next: 'short-pw9', confirm: 'short-pw9' }).next, 'short', '9');
      equal(problems({ next: 'ten-chars!', confirm: 'ten-chars!' }).next, undefined, '10');
    },
  ],
  ['it can’t be the temporary password', () => equal(problems({ current: 'Temp-4821xyz', next: 'Temp-4821xyz', confirm: 'Temp-4821xyz' }).next, 'same')],
  [
    'it can’t be the email, whatever the case or spaces',
    () => {
      equal(problems({ next: 'Mona@Parklane.test', confirm: 'Mona@Parklane.test' }).next, 'email', 'case');
      equal(problems({ next: ' mona@parklane.test ', confirm: ' mona@parklane.test ' }).next, 'email', 'spaces');
    },
  ],
  ['without a known email that rule is left to the backend', () => equal(problems({ email: null, next: 'mona@parklane.test', confirm: 'mona@parklane.test' }), {})],
  ['the confirmation must match exactly', () => equal(problems({ confirm: 'my own garden 78' }).confirm, 'mismatch')],
  ['the length is checked before sameness, so one problem shows at a time', () => equal(problems({ current: 'abc', next: 'abc', confirm: 'abc' }).next, 'short')],
  [
    'the step is needed when the account says so',
    () => {
      equal(needsPasswordChange({ mustChangePassword: true }, false), true, 'flag');
      equal(needsPasswordChange({ mustChangePassword: false }, false), false, 'cleared');
      equal(needsPasswordChange({}, false), false, 'older backend without the field');
    },
  ],
  ['or when a call was refused for it, even if the account read earlier said not', () => equal(needsPasswordChange({ mustChangePassword: false }, true), true)],
  ['without the account (offline at launch) only a refusal asks for it', () => equal([needsPasswordChange(null, false), needsPasswordChange(null, true)], [false, true])],
  ['a sign-in goes to the step or straight into the app', () => equal([routeAfterSignIn({ mustChangePassword: true }, false), routeAfterSignIn({ mustChangePassword: false }, false)], ['ChangePassword', 'Home'])],
  [
    'refusals: wrong temporary password, the backend’s rules, too many tries, anything else as it came',
    () =>
      equal(['unauthorized', 'bad_request', 'rate_limited', 'network', 'internal', null].map(passwordChangeFailure), [
        'wrong_current',
        'rules',
        'rate_limited',
        'other',
        'other',
        'other',
      ]),
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
