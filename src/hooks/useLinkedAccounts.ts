import { useCallback, useEffect, useState } from 'react';

import { EmsError } from '../services/ems/emsApi';
import * as homeApi from '../services/home/homeApi';
import type { FlowStep, LinkedAccount } from '../types/home.types';
import { useEms } from './useEms';

function messageOf(error: unknown): string {
  return error instanceof EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * The brand accounts linked to the resident's home. Re-read whenever the
 * backend says they changed (a flow finished, an account broke or was removed).
 */
export function useLinkedAccounts() {
  const { status, home, accountsVersion, refreshHome } = useEms();
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const hasHome = status === 'signedIn' && home !== null && home.hub.status !== 'provisioning';

  const refresh = useCallback(async () => {
    try {
      setAccounts(await homeApi.listAccounts());
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHome) {
      return;
    }
    let cancelled = false;
    homeApi
      .listAccounts()
      .then(
        (list) => {
          if (cancelled) return;
          setAccounts(list);
          setError(null);
        },
        (caught: unknown) => {
          if (!cancelled) setError(messageOf(caught));
        },
      )
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasHome, accountsVersion]);

  const track = useCallback(async <T,>(id: string, work: () => Promise<T>): Promise<T | null> => {
    setBusy((current) => ({ ...current, [id]: true }));
    try {
      return await work();
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setBusy(({ [id]: _done, ...rest }) => rest);
    }
  }, []);

  /** The brand's "sign in again" step to show, or null when a reload fixed it. */
  const reconnect = useCallback(
    async (account: LinkedAccount): Promise<FlowStep | null> => {
      const result = await track(account.id, () => homeApi.reconnectAccount(account.id));
      void refresh();
      return result?.step ?? null;
    },
    [track, refresh],
  );

  const remove = useCallback(
    async (account: LinkedAccount) => {
      await track(account.id, () => homeApi.removeAccount(account.id));
      void refresh();
      void refreshHome();
    },
    [track, refresh, refreshHome],
  );

  return { hasHome, accounts, loaded, error, busy, refresh, reconnect, remove };
}
