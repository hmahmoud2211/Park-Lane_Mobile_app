import { useCallback, useEffect, useState } from 'react';

import { useEms } from '../../ems/hooks/useEms';
import * as api from '../services/circlesApi';
import type { CircleInvite, OpenCircleInvite } from '../types';

/**
 * A Circle's invites, for its owners: making a code, the codes nobody has used yet, and cancelling one. Nothing is
 * loaded for members (`circleId` null).
 */
export function useCircleInvites(circleId: string | null) {
  const { onRealtimeEvent } = useEms();
  const [open, setOpen] = useState<OpenCircleInvite[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    api.listInvites(circleId).then(
      (invites) => {
        if (!cancelled) setOpen(invites);
      },
      () => {
        // The list is a convenience: making a code still works without it.
        if (!cancelled) setOpen([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [circleId, version]);

  useEffect(() => {
    if (!circleId) return;
    return onRealtimeEvent((event) => {
      if (event.type === 'circle.updated' && event.circleId === circleId) setVersion((current) => current + 1);
    });
  }, [circleId, onRealtimeEvent]);

  const create = useCallback(async (): Promise<CircleInvite> => {
    if (!circleId) throw new Error('No Circle');
    const invite = await api.createInvite(circleId);
    setVersion((current) => current + 1);
    return invite;
  }, [circleId]);

  const cancel = useCallback(
    async (inviteId: string) => {
      if (!circleId) return;
      setOpen(await api.cancelInvite(circleId, inviteId));
    },
    [circleId],
  );

  return { open: circleId ? open : [], create, cancel };
}
