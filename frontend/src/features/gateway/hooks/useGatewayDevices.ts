import { useCallback, useMemo, useState } from 'react';

import { applyOptimistic, sortDevices } from '../../home/services/capabilities';
import * as api from '../services/gatewayApi';
import { toAppDevice, toAppRoom, toGatewayCommand, toGatewayDeviceId } from '../services/deviceMapping';
import { GatewayError, gatewayErrorText } from '../services/gatewayHttp';
import type { Command, Device, Room } from '../../../types/home.types';
import type { CommandResult } from '../../../types/gateway.types';
import type { DeviceBusy } from '../../home/types';
import { useGateway } from './useGateway';

/**
 * Gateway devices in the app's device model, with the same actions as
 * useHomeDevices. A command shows its expected result at once, then what the
 * gateway reports. If the gateway answers `assumed` (the device gives no
 * feedback, e.g. a TV key press) the card says "Not confirmed" instead of
 * presenting it as fact; if the command fails, the device goes back to its
 * last reported state and the card says why.
 */
export function useGatewayDevices() {
  const gateway = useGateway();
  const { target, devices: raw, rooms: rawRooms, upsertDevice, refresh } = gateway;
  const [optimistic, setOptimistic] = useState<Record<string, Device>>({});
  const [busy, setBusy] = useState<Record<string, DeviceBusy>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, CommandResult>>({});

  const devices = useMemo(
    () => sortDevices(raw.map((device) => optimistic[`gw:${device.id}`] ?? toAppDevice(device))),
    [raw, optimistic],
  );
  const rooms = useMemo<Room[]>(() => rawRooms.map(toAppRoom), [rawRooms]);

  const track = useCallback(async <T,>(id: string, kind: DeviceBusy, work: () => Promise<T>): Promise<T | null> => {
    setBusy((current) => ({ ...current, [id]: kind }));
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    try {
      return await work();
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: gatewayErrorText(error) }));
      return null;
    } finally {
      setBusy(({ [id]: _done, ...rest }) => rest);
    }
  }, []);

  const command = useCallback(
    (device: Device, next: Command) =>
      track(device.id, 'command', async () => {
        if (!target) {
          throw new GatewayError('offline', 'Your gateway is not reachable right now.');
        }
        const gatewayId = toGatewayDeviceId(device.id);
        const accepted = raw.find((entry) => entry.id === gatewayId)?.commands ?? [];
        const gatewayCommand = toGatewayCommand(next, accepted);
        if (!gatewayCommand) {
          throw new GatewayError('unsupported_command', 'This device does not offer that control.');
        }
        setOptimistic((current) => ({ ...current, [device.id]: applyOptimistic(device, next) }));
        try {
          const response = await api.sendCommand(target, gatewayId, gatewayCommand);
          upsertDevice(response.device);
          setResults((current) => ({ ...current, [device.id]: response.result }));
          return response.result;
        } catch (error) {
          void refresh();
          throw error;
        } finally {
          setOptimistic(({ [device.id]: _done, ...rest }) => rest);
        }
      }),
    [track, target, raw, upsertDevice, refresh],
  );

  const update = useCallback(
    (device: Device, changes: { name?: string; roomId?: string | null; dashboard?: boolean }) =>
      track(device.id, 'edit', async () => {
        if (!target) {
          throw new GatewayError('offline', 'Your gateway is not reachable right now.');
        }
        const updated = await api.updateDevice(target, toGatewayDeviceId(device.id), {
          name: changes.name,
          room_id: changes.roomId,
          dashboard: changes.dashboard,
        });
        upsertDevice(updated);
        return toAppDevice(updated);
      }),
    [track, target, upsertDevice],
  );

  const clearError = useCallback((id: string) => setErrors(({ [id]: _cleared, ...rest }) => rest), []);

  return { ...gateway, devices, rooms, rawDevices: raw, busy, errors, results, command, update, clearError };
}
