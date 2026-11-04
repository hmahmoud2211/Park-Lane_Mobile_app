import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as api from '../services/gatewayApi';
import { toDeviceControls, toGatewayDeviceId } from '../services/deviceMapping';
import { GatewayError } from '../services/gatewayHttp';
import type { ControlValue } from '../../../types/controls.types';
import type { GatewayCommand } from '../../../types/gateway.types';
import { useGateway } from './useGateway';

function messageOf(error: unknown): string {
  if (error instanceof GatewayError) {
    return error.recovery ? `${error.message} ${error.recovery}` : error.message;
  }
  return 'Something went wrong. Try again.';
}

/** The key the screen uses for the power switch; every other key is one of the device's settings. */
export const POWER_KEY = 'power';

/**
 * One gateway device's settings beyond power (an AC's mode, set point, fan,
 * swing, Jet, timers, filter), kept live by the gateway's event channel, so a
 * change made with the remote shows up here too. Ported from Master's hook
 * (archive/master-2026-11-04), now on the CUBE Gateway.
 *
 * A change shows as pending at once, then as the gateway reports it. When the
 * gateway answers `assumed` or `pending` (the appliance has not echoed the
 * value), the setting is listed in `unconfirmed` with the gateway's note, and
 * the screen says "Not confirmed" rather than presenting it as fact. If the
 * change fails, the setting goes back to what it last reported and `errors`
 * says why. With `debounceMs`, quick repeated taps (a stepper) send only the
 * last value.
 */
export function useAcControls(deviceId: string) {
  const { target, devices, devicesLoaded, status, upsertDevice } = useGateway();
  const gatewayId = toGatewayDeviceId(deviceId);
  const device = devices.find((entry) => entry.id === gatewayId) ?? null;
  const controls = useMemo(() => (device ? toDeviceControls(device) : null), [device]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, ControlValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [unconfirmed, setUnconfirmed] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The latest request per setting, so an older answer does not clear a newer one's pending value. */
  const latest = useRef(new Map<string, number>());
  const requests = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    return () => {
      mounted.current = false;
      pendingTimers.forEach(clearTimeout);
    };
  }, []);

  // A value the appliance later reports itself is confirmed: drop the note once the gateway marks it so.
  useEffect(() => {
    if (!controls) return;
    setUnconfirmed((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(current)) {
        const setting = controls.settings.find((entry) => entry.key === key);
        if (setting?.confirmed && key !== POWER_KEY) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [controls]);

  const reload = useCallback(async () => {
    if (!target) {
      setLoadError('Your gateway is not reachable right now.');
      return;
    }
    try {
      upsertDevice(await api.refreshDevice(target, gatewayId));
      if (mounted.current) setLoadError(null);
    } catch (error) {
      if (mounted.current) setLoadError(messageOf(error));
    }
  }, [target, gatewayId, upsertDevice]);

  const commandFor = useCallback(
    (key: string, value: ControlValue): GatewayCommand => {
      if (key === POWER_KEY) {
        return { command: value ? 'turn_on' : 'turn_off', params: {} };
      }
      const setting = device?.settings.find((entry) => entry.key === key);
      if (setting?.kind === 'button') {
        return { command: 'press', params: { key } };
      }
      return { command: 'set_setting', params: { key, value } };
    },
    [device],
  );

  const send = useCallback(
    async (key: string, value: ControlValue, request: number) => {
      try {
        if (!target) {
          throw new GatewayError('offline', 'Your gateway is not reachable right now.');
        }
        const response = await api.sendCommand(target, gatewayId, commandFor(key, value));
        upsertDevice(response.device);
        if (mounted.current) {
          setUnconfirmed(({ [key]: _previous, ...rest }) =>
            response.result.status === 'confirmed' ? rest : { ...rest, [key]: response.result.message ?? '' },
          );
        }
      } catch (error) {
        if (mounted.current) {
          setErrors((current) => ({ ...current, [key]: messageOf(error) }));
        }
      } finally {
        if (mounted.current && latest.current.get(key) === request) {
          latest.current.delete(key);
          setPending(({ [key]: _done, ...rest }) => rest);
        }
      }
    },
    [target, gatewayId, commandFor, upsertDevice],
  );

  /** Asks for `value` (`null` presses a button); with `debounceMs`, waits that long for a newer value first. */
  const set = useCallback(
    (key: string, value: ControlValue, debounceMs = 0) => {
      requests.current += 1;
      const request = requests.current;
      latest.current.set(key, request);
      setPending((current) => ({ ...current, [key]: value }));
      setErrors(({ [key]: _cleared, ...rest }) => rest);
      clearTimeout(timers.current.get(key));
      if (debounceMs <= 0) {
        void send(key, value, request);
        return;
      }
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          void send(key, value, request);
        }, debounceMs),
      );
    },
    [send],
  );

  const missing = devicesLoaded && !device;
  return {
    device,
    controls,
    /** The device is not (or no longer) on the gateway. */
    missing,
    loadError: loadError ?? (status === 'offline' && !controls ? 'Your gateway is not reachable right now.' : null),
    pending,
    errors,
    unconfirmed,
    set,
    reload,
  };
}
