import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEms } from '../../ems/hooks/useEms';
import { EmsError } from '../../ems/services/emsHttp';
import * as api from '../services/unitApi';
import type { OpenUnitInvite, UnitRole } from '../types';

/**
 * An owner's invites: making one, the ones nobody has used yet, and cancelling one. The list
 * follows the apartment live (someone joined with a code, another owner made or cancelled one).
 * Off (`enabled` false) for members, who can't invite.
 */
export function useUnitInvites(enabled: boolean) {
  const { onRealtimeEvent } = useEms();
  const [loaded, setLoaded] = useState<OpenUnitInvite[] | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.listInvites().then(
      (list) => {
        if (!cancelled) setLoaded(list);
      },
      // The list is a convenience: making and sharing invites works without it.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  useEffect(() => {
    if (!enabled) return;
    return onRealtimeEvent((event) => {
      if (event.type === 'unit.updated') refresh();
    });
  }, [enabled, onRealtimeEvent, refresh]);

  /** Throws EmsError (`rate_limited` once ten are waiting). */
  const create = useCallback(
    async (role: UnitRole) => {
      const invite = await api.createInvite(role);
      refresh();
      return invite;
    },
    [refresh],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        setLoaded(await api.cancelInvite(id));
      } catch (error) {
        // Used or cancelled meanwhile: the list just needs reading again.
        if (error instanceof EmsError && error.code === 'not_found') {
          refresh();
          return;
        }
        throw error;
      }
    },
    [refresh],
  );

  const open = useMemo(() => (enabled ? loaded : null), [enabled, loaded]);
  return { open, create, cancel };
}
