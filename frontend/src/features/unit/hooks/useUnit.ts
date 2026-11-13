import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEms } from '../../ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../ems/services/emsHttp';
import { useGateway } from '../../gateway/hooks/useGateway';
import * as api from '../services/unitApi';
import type { MyUnit, UnitRole } from '../types';

export type UnitState =
  /** Signed out, or a backend without apartments (it answers their routes with a bare 404). */
  | { status: 'hidden' }
  | { status: 'loading' }
  /** Signed in without an apartment: they can join one with a code. */
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'ready'; unit: MyUnit };

type Outcome = Exclude<UnitState, { status: 'loading' }>;

function outcomeOf(error: unknown): Outcome {
  if (error instanceof EmsError) {
    if (error.code === 'no_home') return { status: 'none' };
    // The session ending signs the app out by itself; an older backend has no apartments to show.
    if (error.code === 'not_found' || error.code === 'unauthorized' || error.code === 'not_configured') return { status: 'hidden' };
  }
  return { status: 'error', message: emsErrorText(error) };
}

/**
 * The signed-in resident's apartment: who shares it, owner invites, joining with a code and
 * removing a member. Joining is what gives a resident the unit's devices, so it also re-reads
 * the home and connects the apartment's gateway through the account.
 */
export function useUnit() {
  const ems = useEms();
  const { connectAccount } = useGateway();
  const { refreshHome } = ems;
  // Whose apartment: a different account signing in on this phone never sees the last one's.
  const key = ems.status === 'signedIn' && !ems.passwordChangeRequired ? (ems.user?.id ?? 'session') : null;
  const [loaded, setLoaded] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    api.getUnit().then(
      (unit) => {
        if (!cancelled) setLoaded({ key, outcome: { status: 'ready', unit } });
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

  // Someone joined or was removed (here or on another phone): read the members again.
  const { onRealtimeEvent } = ems;
  useEffect(() => {
    if (!key) return;
    return onRealtimeEvent((event) => {
      if (event.type === 'unit.updated') reload();
    });
  }, [key, onRealtimeEvent, reload]);

  const settle = useCallback(
    (unit: MyUnit) => {
      if (key) setLoaded({ key, outcome: { status: 'ready', unit } });
    },
    [key],
  );

  /** Throws EmsError: `invalid`, `conflict` or `rate_limited` are the ones worth wording. */
  const join = useCallback(
    async (code: string) => {
      const unit = await api.joinUnit(code);
      settle(unit);
      void refreshHome();
      void connectAccount();
      return unit;
    },
    [settle, refreshHome, connectAccount],
  );

  const createInvite = useCallback((role: UnitRole) => api.createInvite(role), []);

  /** Which apartment a code is for, without joining. Throws EmsError like join. */
  const check = useCallback((code: string) => api.checkInvite(code), []);

  const removeMember = useCallback(
    async (userId: string) => {
      try {
        settle(await api.removeMember(userId));
      } catch (error) {
        // Already gone (another owner removed them): the list just needs reading again.
        if (error instanceof EmsError && error.code === 'not_found') {
          reload();
          return;
        }
        throw error;
      }
    },
    [settle, reload],
  );

  const state = useMemo<UnitState>(() => {
    if (!key) return { status: 'hidden' };
    return loaded?.key === key ? loaded.outcome : { status: 'loading' };
  }, [key, loaded]);

  return { state, reload, join, check, createInvite, removeMember };
}
