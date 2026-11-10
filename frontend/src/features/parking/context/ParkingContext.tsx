import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { useEms } from '../../ems/hooks/useEms';
import { EmsError } from '../../ems/services/emsHttp';
import { getParkingSnapshot, RemoteParkingService, type RemoteSnapshot } from '../services/remote';
import type { ParkingDb } from '../services/types';
import { ParkingDemoContext, type ParkingDemoValue } from './parkingValue';

/**
 * Parking from the EMS backend: the apartment's snapshot, fetched while a parking screen is open (ParkingReady
 * retains it) and again whenever the backend says parking changed (`parking.updated`), the app returns to the
 * foreground, or a minute passes; and the service whose methods are API calls. It fills the same context as the
 * offline demo, so screens use either.
 */

const CLOCK_MS = 5_000;
const REFRESH_MS = 60_000;

/** Until the snapshot arrives: nothing to show (screens wait behind ParkingReady). */
const EMPTY: ParkingDb = {
  schemaVersion: 0, policy: {} as ParkingDb['policy'], revision: 0, clockOffsetMs: 0, referenceSerial: 0,
  buildings: [], properties: [], residents: [], associations: [], vehicles: [], zones: [], spaces: [], gates: [], chargers: [], connectors: [],
  reservations: [], invitations: [], credentials: [], sessions: [], allocations: [], chargingSessions: [], scanEvents: [], occupancyEvents: [], notifications: [], audit: [],
};

export function ParkingProvider({ children }: PropsWithChildren) {
  const { status: authStatus, onRealtimeEvent } = useEms();
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [state, setState] = useState<{ status: ParkingDemoValue['status']; error: string | null }>({ status: 'loading', error: null });
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef<RemoteSnapshot | null>(null);
  const generation = useRef(0);
  // Only while a parking screen is open: no requests from anywhere else in the app.
  const users = useRef(0);
  const [active, setActive] = useState(false);
  const retain = useCallback(() => {
    users.current += 1;
    if (users.current === 1) setActive(true);
    return () => {
      users.current -= 1;
      if (users.current === 0) setActive(false);
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await getParkingSnapshot();
      if (mine !== generation.current) return;
      latest.current = next;
      setSnapshot(next);
      setState({ status: 'ready', error: null });
    } catch (error) {
      if (mine !== generation.current) return;
      const code = error instanceof EmsError ? error.code : 'internal';
      // A snapshot already shown stays; only the first load shows the error.
      setState((current) => (latest.current ? current : { status: code === 'no_home' ? 'no_home' : 'error', error: (error as Error).message }));
    }
  }, []);

  const [service] = useState(() => new RemoteParkingService(() => latest.current, () => refresh()));

  // Load while signed in and a parking screen is open; forget on sign-out.
  useEffect(() => {
    if (authStatus !== 'signedIn') {
      latest.current = null;
      generation.current += 1;
      return;
    }
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    const unsubscribe = onRealtimeEvent((event) => {
      if (event.type === 'parking.updated' || event.type === 'ready') void refresh();
    });
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      appState.remove();
      unsubscribe();
    };
  }, [authStatus, active, onRealtimeEvent, refresh]);

  const value = useMemo<ParkingDemoValue>(
    () => ({
      service,
      db: snapshot ?? EMPTY,
      now,
      residentId: snapshot?.me.residentId ?? '',
      storageKind: 'server',
      inviteOrigin: snapshot ? snapshot.inviteBase.replace(/\/pass$/, '') : '',
      status: authStatus === 'signedIn' ? state.status : 'loading',
      error: state.error,
      reload: () => void refresh(),
      securityPhone: snapshot?.securityPhone ?? null,
      retain,
    }),
    [service, snapshot, now, authStatus, state, refresh, retain],
  );

  return <ParkingDemoContext.Provider value={value}>{children}</ParkingDemoContext.Provider>;
}
