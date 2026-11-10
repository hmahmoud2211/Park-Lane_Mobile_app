import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

import { EmsError } from '../features/ems/services/emsHttp';

export interface FocusQuery<T> {
  data: T | undefined;
  error: EmsError | null;
  loading: boolean;
  reload: () => void;
}

const asEmsError = (error: unknown) => (error instanceof EmsError ? error : new EmsError('internal', 'Something went wrong.'));

/**
 * One request for a screen, made again whenever the screen comes back into focus, so a change made elsewhere
 * (building management, another phone) shows without pulling to refresh. Data already shown stays while it
 * reloads; a newer answer always wins. Pass a fetcher made with useCallback. (The clinic has its own copy,
 * useClinicQuery, with the time it loaded.)
 */
export function useFocusQuery<T>(fetcher: () => Promise<T>): FocusQuery<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<EmsError | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    fetcher()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mine === generation.current) setError(asEmsError(caught));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, [fetcher]);

  useFocusEffect(reload);

  return { data, error, loading, reload };
}
