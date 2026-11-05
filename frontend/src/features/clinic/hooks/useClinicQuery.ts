import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

import { EmsError } from '../../ems/services/emsApi';

export interface ClinicQuery<T> {
  data: T | undefined;
  error: EmsError | null;
  loading: boolean;
  /** When `data` arrived, for comparing its times with "now" outside of render. */
  loadedAt: number;
  reload: () => void;
}

const asEmsError = (error: unknown) => (error instanceof EmsError ? error : new EmsError('internal', 'Something went wrong.'));

/**
 * One clinic request for a screen, made again whenever the screen comes
 * back into focus, so a booking or a status change made elsewhere (the
 * clinic, another phone) shows without pulling to refresh. Data already
 * shown stays while it reloads; a newer answer always wins.
 *
 * Pass a fetcher made with useCallback, as with useHealthResource: it
 * loads again when the fetcher changes.
 */
export function useClinicQuery<T>(fetcher: () => Promise<T>): ClinicQuery<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<EmsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0);
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    fetcher()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setLoadedAt(Date.now());
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

  return { data, error, loading, loadedAt, reload };
}
