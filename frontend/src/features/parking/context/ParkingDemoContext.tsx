import * as Crypto from 'expo-crypto';
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';

import { setRandomSource } from '../services/crypto';
import { ParkingRepository } from '../services/repository';
import { ParkingService } from '../services/service';
import { DEMO_INVITE_BASE_URL, DEMO_RESIDENT_ID, DEMO_SECURITY_PHONE } from '../services/demoPeople';
import { createDeviceStorage } from '../services/storage';
import { ParkingDemoContext, type ParkingDemoValue } from './parkingValue';

export { ParkingDemoContext, type ParkingDemoValue };

// Native has no global crypto; expo-crypto supplies the secure bytes for pass tokens.
setRandomSource((bytes) => Crypto.getRandomValues(bytes));

/** How often the scheduled rules run while the app is open. */
const SWEEP_INTERVAL_MS = 30_000;
/** How often time-based labels ("overdue", charging progress) refresh. */
const CLOCK_INTERVAL_MS = 5_000;


/**
 * The demo clock as an external store: it advances every few seconds and
 * at once whenever the repository commits (including a clock jump), so every
 * screen reads the same instant as the rules that just ran.
 */
function createClockStore(repo: ParkingRepository) {
  let current = repo.now();
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;
  const update = () => {
    current = repo.now();
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!stop) {
        const timer = setInterval(update, CLOCK_INTERVAL_MS);
        const unsubscribe = repo.subscribe(update);
        stop = () => {
          clearInterval(timer);
          unsubscribe();
        };
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
  };
}


function originForInvites(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return DEMO_INVITE_BASE_URL;
}

/**
 * Owns the parking demo's store for the whole app. The store, not this
 * component, holds all state; this only re-renders consumers when it
 * commits and runs the scheduled rules on a timer.
 */
/** The offline demo: the rules on this device, with seeded sample data (Demo controls, Security console). */
export function ParkingDemoProvider({ children }: PropsWithChildren) {
  const [service] = useState(() => new ParkingService(new ParkingRepository(createDeviceStorage())));
  const repo = service.repo;

  const db = useSyncExternalStore(
    (listener) => repo.subscribe(listener),
    () => repo.snapshot,
  );

  const [clock] = useState(() => createClockStore(repo));
  const now = useSyncExternalStore(clock.subscribe, clock.getSnapshot);

  useEffect(() => {
    const sweep = setInterval(() => void service.tick(), SWEEP_INTERVAL_MS);
    // Catch up on anything that fell due while the app was in the background.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void service.tick();
      }
    });
    void service.tick();
    return () => {
      clearInterval(sweep);
      appState.remove();
    };
  }, [repo, service]);

  const value = useMemo<ParkingDemoValue>(
    () => ({
      service,
      db,
      now,
      residentId: DEMO_RESIDENT_ID,
      storageKind: repo.storageKind,
      inviteOrigin: originForInvites(),
      status: 'ready',
      error: null,
      reload: () => void service.tick(),
      securityPhone: DEMO_SECURITY_PHONE,
      retain: () => () => undefined,
    }),
    [service, db, now, repo],
  );

  return <ParkingDemoContext.Provider value={value}>{children}</ParkingDemoContext.Provider>;
}
