import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  askForLocation,
  locationAccess,
  openLocationSettings,
  sharingUpdatesRunning,
  startSharingUpdates,
  stopSharingUpdates,
} from '../services/locationSharing';
import type { Circle, LocationAccess } from '../types';

export type TurnOnResult = 'on' | 'denied' | 'unsupported';

/**
 * The sharing switch and what the phone allows. Turning sharing on asks the phone (after the screen has shown its
 * explanation), tells the backend, then starts the background updates. Turning it off in the last Circle where the
 * person shares stops them. While the screen is open the updates are kept in step with the backend, so a phone that
 * was reinstalled, or whose updates the system stopped, starts again.
 */
export function useLocationSharing(circles: readonly Circle[] | null, setSharing: (circleId: string, sharing: boolean) => Promise<Circle>) {
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const read = () =>
      locationAccess().then((next) => {
        if (active) setAccess(next);
      });
    void read();
    // Coming back from the phone's settings: read what was chosen there.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const sharesAnywhere = circles?.some((circle) => circle.sharing) ?? false;
  const allowed = access === 'always' || access === 'whileUsing';

  useEffect(() => {
    if (circles === null || access === null || busy) return;
    let cancelled = false;
    void (async () => {
      const running = await sharingUpdatesRunning();
      if (cancelled) return;
      if (sharesAnywhere && allowed && !running) await startSharingUpdates().catch(() => undefined);
      if (!sharesAnywhere && running) await stopSharingUpdates().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [circles, access, allowed, busy, sharesAnywhere]);

  const turnOn = useCallback(
    async (circleId: string): Promise<TurnOnResult> => {
      setBusy(true);
      try {
        let current = await locationAccess();
        if (current === 'unsupported') return 'unsupported';
        if (current !== 'always' && current !== 'whileUsing') current = await askForLocation();
        setAccess(current);
        if (current !== 'always' && current !== 'whileUsing') return 'denied';
        await setSharing(circleId, true);
        await startSharingUpdates();
        return 'on';
      } finally {
        setBusy(false);
      }
    },
    [setSharing],
  );

  const turnOff = useCallback(
    async (circleId: string) => {
      setBusy(true);
      try {
        await setSharing(circleId, false);
        const stillSharing = circles?.some((circle) => circle.id !== circleId && circle.sharing) ?? false;
        if (!stillSharing) await stopSharingUpdates();
      } finally {
        setBusy(false);
      }
    },
    [circles, setSharing],
  );

  /** Asks for "Always" again (opens the phone's settings on Android 11 and later). */
  const askAlways = useCallback(async () => setAccess(await askForLocation()), []);

  return { access, busy, turnOn, turnOff, askAlways, openSettings: openLocationSettings };
}
