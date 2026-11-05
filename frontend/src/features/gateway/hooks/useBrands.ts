import { useCallback, useEffect, useState } from 'react';

import * as api from '../services/gatewayApi';
import { errorMessage } from '../services/gatewayHttp';
import type { Brand } from '../../../types/gateway.types';
import { useGateway } from './useGateway';

/** Brands only change with the gateway's adapters, so the list is kept per gateway for the session. */
const cache = new Map<string, Brand[]>();

/** The gateway's brands (GET /brands), shared by the Add Device screens. */
export function useBrands() {
  const { target, active } = useGateway();
  const key = active?.id ?? null;
  const [loaded, setLoaded] = useState<{ key: string; list: Brand[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const brands = key ? (loaded?.key === key ? loaded.list : (cache.get(key) ?? null)) : null;

  const load = useCallback(async () => {
    if (!target || !key) {
      return;
    }
    try {
      const list = await api.listBrands(target);
      cache.set(key, list);
      setLoaded({ key, list });
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure, 'The brands could not be loaded.'));
    }
  }, [target, key]);

  useEffect(() => {
    if (!target || !key) return;
    let cancelled = false;
    api.listBrands(target).then(
      (list) => {
        cache.set(key, list);
        if (cancelled) return;
        setLoaded({ key, list });
        setError(null);
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure, 'The brands could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, key]);

  return { brands, error, reload: load };
}
