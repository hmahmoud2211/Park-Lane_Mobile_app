import { useCallback, useState } from 'react';

import { EmsError } from '../services/ems/emsApi';
import { applyOptimistic } from '../services/home/capabilities';
import * as homeApi from '../services/home/homeApi';
import type { Command, Device } from '../types/home.types';
import { useEms } from './useEms';

export type DeviceBusy = 'command' | 'edit';

function messageOf(error: unknown): string {
  return error instanceof EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * Device actions over the shared list in EmsContext.
 *
 * A command shows its result at once, then the state the hub reported. If the
 * hub refuses, the device goes back to how it was and the card says why; it
 * never shows a state that did not happen.
 */
export function useHomeDevices() {
  const ems = useEms();
  const { upsertDevice, refreshHome } = ems;
  const [busy, setBusy] = useState<Record<string, DeviceBusy>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const track = useCallback(async <T,>(id: string, kind: DeviceBusy, work: () => Promise<T>): Promise<T | null> => {
    setBusy((current) => ({ ...current, [id]: kind }));
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    try {
      return await work();
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: messageOf(error) }));
      return null;
    } finally {
      setBusy(({ [id]: _done, ...rest }) => rest);
    }
  }, []);

  const command = useCallback(
    (device: Device, next: Command) =>
      track(device.id, 'command', async () => {
        upsertDevice(applyOptimistic(device, next));
        try {
          const confirmed = await homeApi.sendCommand(device.id, next);
          upsertDevice(confirmed);
          return confirmed;
        } catch (error) {
          // Back to the last confirmed state; the realtime event or the re-read brings the backend's view.
          upsertDevice(device);
          void refreshHome();
          throw error;
        }
      }),
    [track, upsertDevice, refreshHome],
  );

  const update = useCallback(
    (device: Device, changes: homeApi.DeviceChanges) =>
      track(device.id, 'edit', async () => {
        const updated = await homeApi.updateDevice(device.id, changes);
        upsertDevice(updated);
        return updated;
      }),
    [track, upsertDevice],
  );

  const clearError = useCallback((id: string) => setErrors(({ [id]: _cleared, ...rest }) => rest), []);

  return { ...ems, busy, errors, command, update, clearError };
}
