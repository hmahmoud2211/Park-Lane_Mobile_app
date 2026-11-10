import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { RealtimeEvent } from '../../../../shared/contracts/events';
import { useEms } from '../../features/ems/hooks/useEms';

const QUARTER_MS = 15 * 60_000;

export interface QuarterHourly<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Data that changes every quarter hour (building readings, an apartment's energy). Loads at once; reloads when the
 * backend pushes `event` (the new reading is current); as a fallback, reloads at the next quarter hour plus 5 to
 * 30 seconds of jitter, so phones don't all ask at once; reloads when the app comes back to the foreground, and does
 * nothing in the background. Pass a loader made with useCallback.
 */
export function useQuarterHourly<T>(load: () => Promise<T>, event: Extract<RealtimeEvent['type'], 'bms.reading' | 'energy.reading'>): QuarterHourly<T> {
  const { onRealtimeEvent } = useEms();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    load()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (mine === generation.current) setError(caught instanceof Error ? caught : new Error('Something went wrong.'));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, [load]);

  useEffect(() => {
    let active = AppState.currentState !== 'background';
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      if (!active) return;
      const now = Date.now();
      const next = (Math.floor(now / QUARTER_MS) + 1) * QUARTER_MS;
      timer.current = setTimeout(() => {
        reload();
        arm();
      }, next - now + 5_000 + Math.random() * 25_000);
    };
    reload();
    arm();
    const unsubscribe = onRealtimeEvent((message) => {
      if (message.type === event || message.type === 'ready') {
        reload();
        arm();
      }
    });
    const appState = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      if (active) reload();
      arm();
    });
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
      appState.remove();
    };
  }, [event, onRealtimeEvent, reload]);

  return { data, error, loading, reload };
}
