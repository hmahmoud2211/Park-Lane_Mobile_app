import { useCallback, useEffect, useRef, useState } from 'react';

import { CubeApiError, getDevices, setDevicePower } from '../services/cube/cubeApi';
import type { CubeDevice } from '../services/cube/cube.types';

export type CubeStatus = 'connecting' | 'connected' | 'unreachable';

function errorMessage(error: unknown): string {
  return error instanceof CubeApiError ? error.message : 'Something went wrong with the smart home hub.';
}

/** The devices on the unit's eWeLink CUBE hub, with power switching. */
export function useCubeDevices() {
  const [devices, setDevices] = useState<CubeDevice[]>([]);
  const [status, setStatus] = useState<CubeStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    () =>
      getDevices().then(
        (list) => {
          if (mounted.current) {
            setDevices(list);
            setStatus('connected');
            setError(null);
          }
          return list;
        },
        (caught: unknown) => {
          if (mounted.current) {
            setStatus('unreachable');
            setError(errorMessage(caught));
          }
          return null;
        },
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Flips the switch at once, and puts it back if the hub refuses. */
  const setPower = useCallback(async (serialNumber: string, on: boolean) => {
    const apply = (value: 'on' | 'off') =>
      setDevices((current) =>
        current.map((device) =>
          device.serial_number === serialNumber
            ? { ...device, state: { ...device.state, power: { powerState: value } } }
            : device,
        ),
      );

    apply(on ? 'on' : 'off');
    try {
      await setDevicePower(serialNumber, on);
    } catch (caught) {
      if (mounted.current) {
        apply(on ? 'off' : 'on');
        setError(errorMessage(caught));
      }
    }
  }, []);

  return { devices, status, error, refresh, setPower };
}
