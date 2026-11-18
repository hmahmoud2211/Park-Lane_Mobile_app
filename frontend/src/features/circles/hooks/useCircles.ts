import { useCallback, useEffect, useState } from 'react';

import { useEms } from '../../ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../ems/services/emsHttp';
import * as api from '../services/circlesApi';
import { withPosition } from '../services/circleRules';
import type { Circle, CircleInvitePreview } from '../types';

export type CirclesState =
  /** Signed out, or a backend without Family Circle (it answers the routes with a bare 404). */
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; circles: Circle[] };

type Outcome = Exclude<CirclesState, { status: 'loading' }>;

function outcomeOf(error: unknown): Outcome {
  if (error instanceof EmsError && (error.code === 'not_found' || error.code === 'unauthorized' || error.code === 'not_configured')) {
    return { status: 'hidden' };
  }
  return { status: 'error', message: emsErrorText(error) };
}

/**
 * The signed-in person's Family Circles, kept live: a member's new position arrives over the realtime channel
 * (`location.updated`) and goes straight onto the map; any other change (`circle.updated`) re-reads the list.
 */
export function useCircles() {
  const ems = useEms();
  // Whose Circles: a different account signing in on this phone never sees the last one's.
  const key = ems.status === 'signedIn' && !ems.passwordChangeRequired ? (ems.user?.id ?? 'session') : null;
  const [loaded, setLoaded] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    api.listCircles().then(
      (circles) => {
        if (!cancelled) setLoaded({ key, outcome: { status: 'ready', circles } });
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ key, outcome: outcomeOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => {
    // A retry after a failure shows it loading again; a refresh keeps the list on screen meanwhile.
    setLoaded((current) => (current?.outcome.status === 'error' ? null : current));
    setVersion((current) => current + 1);
  }, []);

  const { onRealtimeEvent } = ems;
  useEffect(() => {
    if (!key) return;
    return onRealtimeEvent((event) => {
      if (event.type === 'location.updated') {
        setLoaded((current) =>
          current?.key === key && current.outcome.status === 'ready'
            ? { key, outcome: { status: 'ready', circles: withPosition(current.outcome.circles, event.member) } }
            : current,
        );
      } else if (event.type === 'circle.updated' || event.type === 'ready') {
        reload();
      }
    });
  }, [key, onRealtimeEvent, reload]);

  /** Puts answers from the backend in place without waiting for a re-read. */
  const settle = useCallback(
    (update: (circles: Circle[]) => Circle[]) => {
      setLoaded((current) =>
        key && current?.key === key && current.outcome.status === 'ready'
          ? { key, outcome: { status: 'ready', circles: update(current.outcome.circles) } }
          : current,
      );
    },
    [key],
  );
  const replace = useCallback((circle: Circle) => settle((circles) => (circles.some((c) => c.id === circle.id) ? circles.map((c) => (c.id === circle.id ? circle : c)) : [...circles, circle])), [settle]);

  const create = useCallback(
    async (name: string) => {
      const circle = await api.createCircle(name);
      replace(circle);
      return circle;
    },
    [replace],
  );

  const check = useCallback((code: string): Promise<CircleInvitePreview> => api.checkInvite(code), []);

  const join = useCallback(
    async (code: string) => {
      const circle = await api.joinCircle(code);
      replace(circle);
      return circle;
    },
    [replace],
  );

  const rename = useCallback(async (id: string, name: string) => replace(await api.renameCircle(id, name)), [replace]);

  const setSharing = useCallback(async (id: string, sharing: boolean) => {
    const circle = await api.setSharing(id, sharing);
    replace(circle);
    return circle;
  }, [replace]);

  /** Owners remove someone; with my own id, I leave. */
  const removeMember = useCallback(
    async (id: string, userId: string) => {
      const circles = await api.removeMember(id, userId);
      settle(() => circles);
      return circles;
    },
    [settle],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteCircle(id);
      settle((circles) => circles.filter((circle) => circle.id !== id));
    },
    [settle],
  );

  const state: CirclesState = !key ? { status: 'hidden' } : loaded?.key === key ? loaded.outcome : { status: 'loading' };
  return { state, reload, create, check, join, rename, setSharing, removeMember, remove };
}
