import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as api from '../services/gatewayApi';
import { GatewayError, errorMessage } from '../services/gatewayHttp';
import { phoneRows, type PhoneRow } from '../services/gatewayPhones';
import type { GatewayClient } from '../../../types/gateway.types';
import { useGateway } from './useGateway';

export type PhonesState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: PhoneRow[] };

/**
 * The active gateway's phones, for its owner to find and remove a lost one. Hidden unless
 * this phone is an owner and the gateway is online; a gateway that answers 403 (the role
 * changed) hides it too. Removing an account-issued phone also ends its EMS sign-in, which
 * the gateway does itself.
 */
export function useGatewayPhones(myAccountId: string | null) {
  const { target, active } = useGateway();
  const owner = active?.role === 'owner';
  // A re-issued token or a new address reads the list again; other changes to the stored gateway don't.
  const key = owner && active && target ? `${active.id}|${active.token}|${target.baseUrl}` : null;
  const ownClientId = active?.clientId ?? '';
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const [loaded, setLoaded] = useState<{ key: string; clients: GatewayClient[]; at: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; forbidden: boolean } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const current = targetRef.current;
    if (!key || !current) return;
    let cancelled = false;
    api.listClients(current).then(
      (clients) => {
        if (cancelled) return;
        setLoaded({ key, clients, at: Date.now() });
        setFailure(null);
      },
      (error: unknown) => {
        if (cancelled) return;
        setFailure({
          key,
          forbidden: error instanceof GatewayError && error.code === 'forbidden',
          message: errorMessage(error, 'The phones could not be loaded.'),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => {
    setFailure(null);
    setVersion((current) => current + 1);
  }, []);

  /** Removes another phone, then reads the list again. Throws GatewayError when the gateway refuses. */
  const remove = useCallback(
    async (clientId: string) => {
      const current = targetRef.current;
      if (!current) {
        throw new GatewayError('network', 'Your gateway is not reachable right now.');
      }
      try {
        await api.revokeClient(current, clientId);
      } catch (error) {
        // Already gone (removed from another owner's phone): the list just needs reading again.
        if (!(error instanceof GatewayError && error.code === 'not_found')) {
          throw error;
        }
      }
      setLoaded((list) => (list ? { ...list, clients: list.clients.filter((entry) => entry.id !== clientId) } : list));
      reload();
    },
    [reload],
  );

  const state = useMemo<PhonesState>(() => {
    if (!key) return { status: 'hidden' };
    if (failure?.key === key) {
      return failure.forbidden ? { status: 'hidden' } : { status: 'error', message: failure.message };
    }
    if (loaded?.key === key) {
      return { status: 'ready', rows: phoneRows(loaded.clients, { ownClientId, myAccountId, nowMs: loaded.at }) };
    }
    return { status: 'loading' };
  }, [key, failure, loaded, ownClientId, myAccountId]);

  return { state, reload, remove };
}
