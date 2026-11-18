import { useEffect, useRef, useState } from 'react';

import { glideStep } from '../services/circleRules';
import type { CircleMember } from '../types';

/** Long enough to look smooth, shorter than live view's ~3 seconds between positions so the pin is never behind. */
const GLIDE_MS = 2_000;
/** About 12 steps a second: smooth on a map without redrawing it on every frame. */
const FRAME_MS = 80;

/**
 * The members with their pins sliding from where they were shown to their new position over two seconds, instead
 * of jumping. A big jump (a phone that was off for a while) is shown at once (glideStep).
 */
export function useGlidingMembers(members: readonly CircleMember[]): readonly CircleMember[] {
  const [shown, setShown] = useState<readonly CircleMember[]>(members);
  const shownRef = useRef(shown);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    const from = new Map(shownRef.current.flatMap((member) => (member.location ? [[member.userId, member.location] as const] : [])));
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / GLIDE_MS);
      setShown(
        members.map((member) => {
          const start = from.get(member.userId);
          return start && member.location ? { ...member, location: { ...member.location, ...glideStep(start, member.location, progress) } } : member;
        }),
      );
      if (progress >= 1) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [members]);

  return shown;
}
