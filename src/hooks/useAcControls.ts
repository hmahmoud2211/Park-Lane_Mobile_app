import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '../services/ems/emsApi';
import type { ControlValue, DeviceControls } from '../types/ems.types';
import { useEms } from './useEms';

function messageOf(error: unknown): string {
  return error instanceof api.EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * One device's settings beyond power (an AC's mode, set point, fan, swing,
 * timers, filter), kept live by the realtime channel, so a change made with
 * the remote shows up here too.
 *
 * A change shows as pending at once, then as the value the device
 * confirmed. If the device does not confirm, the setting goes back to what
 * it last reported and `errors` says why. With `debounceMs`, quick repeated
 * taps (a stepper) send only the last value.
 */
export function useAcControls(deviceId: string) {
  const { subscribeControls, realtime } = useEms();
  const [controls, setControls] = useState<DeviceControls | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, ControlValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  const load = useCallback(async () => {
    try {
      const next = await api.getDeviceControls(deviceId);
      if (mounted.current) {
        setControls(next);
        setLoadError(null);
      }
    } catch (error) {
      if (mounted.current) {
        setLoadError(messageOf(error));
      }
    }
  }, [deviceId]);

  useEffect(() => subscribeControls(deviceId, setControls), [deviceId, subscribeControls]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pushes sent while the channel was down are lost; read again once it is back.
  const wasLive = useRef(realtime === 'live');
  useEffect(() => {
    if (realtime === 'live' && !wasLive.current) {
      void load();
    }
    wasLive.current = realtime === 'live';
  }, [realtime, load]);

  const send = useCallback(
    async (key: string, value: ControlValue, request: number) => {
      try {
        const confirmed = await api.setDeviceControl(deviceId, key, value);
        if (mounted.current) {
          setControls(confirmed);
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
    [deviceId],
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

  return { controls, loadError, pending, errors, set, reload: load };
}
