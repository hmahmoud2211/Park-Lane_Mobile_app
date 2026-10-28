import { useCallback, useState } from 'react';

import * as api from '../services/ems/emsApi';
import type { SmartDevice } from '../types/ems.types';
import { useEms } from './useEms';

export type DeviceBusy = 'power' | 'edit' | 'remove';

function messageOf(error: unknown): string {
  return error instanceof api.EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * Device actions over the shared list in EmsContext.
 *
 * Switching shows the requested state as pending at once, then the state the
 * device confirmed. If the device does not confirm, the switch goes back to
 * its last confirmed state and the card says why; it never shows a state
 * that did not happen.
 */
export function useEmsDevices() {
  const ems = useEms();
  const { upsertDevice, dropDevice, refreshDevices } = ems;
  const [busy, setBusy] = useState<Record<string, DeviceBusy>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const track = useCallback(
    async <T,>(id: string, kind: DeviceBusy, work: () => Promise<T>): Promise<T | null> => {
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
    },
    [],
  );

  const setPower = useCallback(
    (device: SmartDevice, on: boolean) =>
      track(device.id, 'power', async () => {
        const power = on ? 'on' : 'off';
        upsertDevice({ ...device, pendingPower: power });
        try {
          const confirmed = await api.setDevicePower(device.id, power);
          upsertDevice(confirmed);
          return confirmed;
        } catch (error) {
          // Back to the last confirmed state; the realtime event or the re-read brings the backend's view.
          upsertDevice({ ...device, pendingPower: null });
          void refreshDevices();
          throw error;
        }
      }),
    [track, upsertDevice, refreshDevices],
  );

  const update = useCallback(
    (device: SmartDevice, changes: api.DeviceChanges) =>
      track(device.id, 'edit', async () => {
        const updated = await api.updateDevice(device.id, changes);
        upsertDevice(updated);
        if (changes.isDefault) {
          // The previous default changed too.
          void refreshDevices();
        }
        return updated;
      }),
    [track, upsertDevice, refreshDevices],
  );

  const remove = useCallback(
    (device: SmartDevice) =>
      track(device.id, 'remove', async () => {
        await api.removeDevice(device.id);
        dropDevice(device.id);
        return true;
      }),
    [track, dropDevice],
  );

  const addVirtual = useCallback(
    async (input: api.NewVirtualDevice) => {
      const device = await api.addVirtualDevice(input);
      upsertDevice(device);
      return device;
    },
    [upsertDevice],
  );

  const addLg = useCallback(
    async (input: Parameters<typeof api.addLgAppliance>[0]) => {
      const device = await api.addLgAppliance(input);
      upsertDevice(device);
      return device;
    },
    [upsertDevice],
  );

  const clearError = useCallback((id: string) => setErrors(({ [id]: _cleared, ...rest }) => rest), []);

  return { ...ems, busy, errors, setPower, update, remove, addVirtual, addLg, clearError };
}
