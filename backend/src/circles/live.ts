import type { LiveWatch } from '../../../shared/contracts/circles.ts';
import type { User } from '../ems/auth.ts';
import { publish } from '../ems/events.ts';
import { ApiError } from '../errors.ts';
import { findMember, listMembers } from '../repositories/circles.ts';

/**
 * Live view (docs/plans/FAMILY_CIRCLE_PLAN.md): while someone has a Circle's map open, its sharing members' phones send
 * fast updates instead of the battery-saving ones. The open map says so every ~30 seconds (watchCircle); each watch
 * keeps them live for a minute, so closing the map ends it within a minute without a goodbye. A phone learns it
 * should go live straight away over the realtime channel when its app is open (`location.live`), otherwise from the
 * answer to its next report (`liveUntil`).
 *
 * Kept in memory: the backend is one process, and losing it on a restart only means phones go back to normal
 * updates until the next watch.
 */

export const WATCH_TTL_MS = 60_000;

const liveUntil = new Map<string, number>();

/** Until when the person should send fast updates, or null when nobody watches. */
export function liveUntilOf(userId: string, now = Date.now()): number | null {
  const until = liveUntil.get(userId);
  if (until === undefined) return null;
  if (until <= now) {
    liveUntil.delete(userId);
    return null;
  }
  return until;
}

/** POST /api/location/watch: the Circle's map is open on `user`'s phone. */
export function watchCircle(user: User, circleIdInput: unknown, now = Date.now()): LiveWatch {
  const circleId = typeof circleIdInput === 'string' ? circleIdInput : '';
  if (!circleId || !findMember(circleId, user.id)) {
    throw new ApiError('not_found', 'That Circle doesn\'t exist, or you\'re not in it.');
  }
  const until = now + WATCH_TTL_MS;
  const sharers = listMembers(circleId).filter((member) => member.sharing && member.userId !== user.id);
  for (const member of sharers) {
    const wasLive = liveUntilOf(member.userId, now) !== null;
    liveUntil.set(member.userId, Math.max(until, liveUntil.get(member.userId) ?? 0));
    // Only a phone that was not live yet needs telling; one already live hears the new time in its next answer.
    if (!wasLive) publish(member.userId, { type: 'location.live', until });
  }
  return { liveUntil: until, members: sharers.length };
}

/** For tests. */
export function resetLive(): void {
  liveUntil.clear();
}
