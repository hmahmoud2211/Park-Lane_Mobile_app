import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { watchCircle } from '../services/circlesApi';

/** The backend keeps a watch for a minute; renewing at half that leaves room for a slow answer. */
const RENEW_MS = 30_000;
/** Live view pauses after this long, so a map left open doesn't keep everyone's phone busy. */
const MAX_WATCH_MS = 10 * 60_000;

export type LiveState =
  /** Nobody to watch (no Circle, nobody sharing besides me), or the screen is not in front. */
  | 'off'
  | 'live'
  /** Ten minutes passed: the person taps to watch live again. */
  | 'paused';

/**
 * Live view from the watching side: while the Circle's map is in front and the app is open, it tells the backend
 * every 30 seconds, and the people who share in the Circle send fast updates. It pauses after 10 minutes until
 * `resume`, and stops by itself (within a minute) when the screen closes or the app goes to the background.
 */
export function useLiveWatch(circleId: string | null, active: boolean) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [members, setMembers] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);

  const watching = Boolean(circleId) && active && foreground && !paused;

  useEffect(() => {
    if (!watching || !circleId) return;
    let cancelled = false;
    const renew = () => {
      if (Date.now() - startedAt >= MAX_WATCH_MS) {
        setPaused(true);
        return;
      }
      watchCircle(circleId).then(
        (answer) => {
          if (!cancelled) setMembers(answer.members);
        },
        () => {
          // A missed renewal only means a slower update or two; the next one tries again.
        },
      );
    };
    const first = setTimeout(renew, 0);
    const timer = setInterval(renew, RENEW_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [watching, circleId, startedAt]);

  const resume = useCallback(() => {
    setStartedAt(Date.now());
    setPaused(false);
  }, []);

  const state: LiveState = paused ? 'paused' : watching && members > 0 ? 'live' : 'off';
  return { state, resume };
}
