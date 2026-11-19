/**
 * Behaviour checks for showing a Family Circle: "last seen" wording, battery chips, the map's opening camera, and
 * live position updates reaching only Circles where the person shares.
 *
 *   npm run check:circles
 */

import type { Circle, CircleMember } from '../types';
import { batteryLabel, batteryTone, cameraFor, circleInviteMessage, glideStep, lastSeenLabel, memberState, withPosition } from './circleRules';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

const member = (userId: string, fields: Partial<CircleMember> = {}): CircleMember => ({
  userId,
  name: userId,
  role: 'member',
  you: false,
  since: '2026-11-01T10:00:00.000Z',
  sharing: false,
  location: null,
  battery: null,
  ...fields,
});

const circle = (id: string, members: CircleMember[]): Circle => ({ id, name: id, role: 'owner', sharing: false, members });

const checks: [string, () => void][] = [
  [
    'last seen reads like a person would say it',
    () => {
      equal(lastSeenLabel(ago(20_000), NOW), 'Just now', 'seconds');
      equal(lastSeenLabel(ago(5 * 60_000), NOW), '5 min ago', 'minutes');
      equal(lastSeenLabel(ago(3 * 3_600_000), NOW), '3 h ago', 'hours');
      equal(lastSeenLabel(ago(30 * 3_600_000), NOW), 'Yesterday', 'yesterday');
      equal(lastSeenLabel(new Date(NOW + 30_000).toISOString(), NOW), 'Just now', 'a phone clock slightly ahead');
    },
  ],
  [
    'the battery chip warns when it runs low, unless charging',
    () => {
      equal(batteryLabel({ level: 0.734, charging: true }), '73% · charging', 'label');
      equal(batteryTone({ level: 0.1, charging: false }), 'red', 'low');
      equal(batteryTone({ level: 0.25, charging: false }), 'amber', 'getting low');
      equal(batteryTone({ level: 0.1, charging: true }), 'teal', 'charging');
    },
  ],
  [
    'a member who shares without a position yet is waiting, not missing',
    () => {
      equal(memberState(member('a')), 'notSharing', 'off');
      equal(memberState(member('a', { sharing: true })), 'waiting', 'no fix yet');
      equal(memberState(member('a', { sharing: true, location: { lat: 30, lng: 31, accuracyM: 10, at: ago(0) } })), 'located', 'located');
    },
  ],
  [
    'the map opens on everyone, close in for one person',
    () => {
      equal(cameraFor([member('a')]), null, 'nobody located');
      const one = cameraFor([member('a', { sharing: true, location: { lat: 30.0, lng: 31.2, accuracyM: 10, at: ago(0) } })]);
      equal(one, { latitude: 30, longitude: 31.2, zoom: 15 }, 'one');
      const two = cameraFor([
        member('a', { sharing: true, location: { lat: 30.0, lng: 31.2, accuracyM: 10, at: ago(0) } }),
        member('b', { sharing: true, location: { lat: 30.2, lng: 31.4, accuracyM: 10, at: ago(0) } }),
      ]);
      equal(two?.latitude.toFixed(2), '30.10', 'centred');
      equal((two?.zoom ?? 0) < 15 && (two?.zoom ?? 0) >= 3, true, 'zoomed out to fit');
    },
  ],
  [
    'a live position reaches only Circles where the person shares',
    () => {
      const shared = circle('family', [member('son', { sharing: true })]);
      const notShared = circle('friends', [member('son', { sharing: false })]);
      const location = { lat: 30.05, lng: 31.23, accuracyM: 12, at: ago(0) };
      const [family, friends] = withPosition([shared, notShared], { userId: 'son', location, battery: { level: 0.5, charging: false } });
      equal(family.members[0].location, location, 'shared');
      equal(friends.members[0].location, null, 'not shared');
    },
  ],
  [
    'a pin slides to its new position, but jumps when it was far away',
    () => {
      const from = { lat: 30.0, lng: 31.0 };
      const to = { lat: 30.001, lng: 31.001 };
      equal(glideStep(from, to, 0), from, 'start');
      equal(glideStep(from, to, 1), to, 'end');
      const half = glideStep(from, to, 0.5);
      equal(half.lat > from.lat && half.lat < to.lat, true, 'in between');
      equal(half.lat - from.lat > (to.lat - from.lat) / 2, true, 'eases out: past halfway at half time');
      equal(glideStep(from, { lat: 30.5, lng: 31.5 }, 0.1), { lat: 30.5, lng: 31.5 }, 'far: lands at once');
    },
  ],
  ['the invite message carries the code and the app name', () => equal(circleInviteMessage('Family', 'K7Q4-9MXD', 'Parklane').includes('Parklane app') && circleInviteMessage('Family', 'K7Q4-9MXD').includes('K7Q4-9MXD'), true)],
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
