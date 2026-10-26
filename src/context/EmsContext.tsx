import { createContext, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import * as api from '../services/ems/emsApi';
import { EmsRealtime } from '../services/ems/realtime';
import { sessionStore } from '../services/ems/sessionStore';
import type { EmsEvent, EmsUser, RealtimeState, SmartDevice } from '../types/ems.types';

/**
 * The EMS session and its live device list, shared by every screen that
 * shows devices.
 *
 * The list comes from the backend and is kept current by the realtime
 * channel, so a switch flipped from another phone or the device itself
 * shows up without polling. When the channel is down the list is
 * re-read on reconnect and on returning to the foreground.
 */

export type EmsAuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface EmsContextValue {
  status: EmsAuthStatus;
  user: EmsUser | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set when the backend ended the session (expired or revoked). */
  sessionNotice: string | null;

  devices: SmartDevice[];
  devicesLoaded: boolean;
  devicesError: string | null;
  realtime: RealtimeState;
  refreshDevices: () => Promise<void>;
  /** Puts a device the API returned into the list (realtime may deliver it too). */
  upsertDevice: (device: SmartDevice) => void;
  dropDevice: (id: string) => void;
}

export const EmsContext = createContext<EmsContextValue | undefined>(undefined);

function messageOf(error: unknown): string {
  return error instanceof api.EmsError ? error.message : 'Something went wrong talking to the EMS backend.';
}

const byRoomThenName = (a: SmartDevice, b: SmartDevice) =>
  (a.room ?? '￿').localeCompare(b.room ?? '￿') || a.name.localeCompare(b.name);

export function EmsProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<EmsAuthStatus>('loading');
  const [user, setUser] = useState<EmsUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<SmartDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>('offline');
  const channel = useRef<EmsRealtime | null>(null);

  const endSession = useCallback(async (notice: string | null) => {
    channel.current?.stop();
    channel.current = null;
    api.setSessionToken(null);
    await sessionStore.clear();
    setToken(null);
    setUser(null);
    setDevices([]);
    setDevicesLoaded(false);
    setSessionNotice(notice);
    setStatus('signedOut');
  }, []);

  const begin = useCallback(async (next: { user: EmsUser; token: string }) => {
    api.setSessionToken(next.token);
    await sessionStore.save(next.token);
    setSessionNotice(null);
    setUser(next.user);
    setToken(next.token);
    setStatus('signedIn');
  }, []);

  // Restore the stored session on launch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = api.isEmsConfigured() ? await sessionStore.load() : null;
      if (!stored) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      api.setSessionToken(stored);
      try {
        const me = await api.getMe();
        if (!cancelled) {
          setUser(me.user);
          setToken(stored);
          setStatus('signedIn');
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof api.EmsError && error.code === 'unauthorized') {
          await endSession('Your EMS session ended. Sign in again.');
        } else {
          // Offline at launch: keep the session and retry when screens ask.
          setToken(stored);
          setUser(null);
          setStatus('signedIn');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endSession]);

  useEffect(() => api.onSessionExpired(() => void endSession('Your EMS session ended. Sign in again.')), [endSession]);

  const upsertDevice = useCallback((device: SmartDevice) => {
    setDevices((current) => [...current.filter((entry) => entry.id !== device.id), device].sort(byRoomThenName));
  }, []);

  const dropDevice = useCallback((id: string) => {
    setDevices((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await api.listDevices();
      setDevices([...list].sort(byRoomThenName));
      setDevicesError(null);
      if (!user) {
        api.getMe().then((me) => setUser(me.user), () => undefined);
      }
    } catch (error) {
      setDevicesError(messageOf(error));
    } finally {
      setDevicesLoaded(true);
    }
  }, [user]);

  const refreshRef = useRef(refreshDevices);
  useEffect(() => {
    refreshRef.current = refreshDevices;
  }, [refreshDevices]);

  // One realtime channel per session.
  useEffect(() => {
    if (status !== 'signedIn' || !token) {
      return;
    }
    const onEvent = (event: EmsEvent) => {
      if (event.type === 'ready') {
        // Anything missed while disconnected.
        void refreshRef.current();
      } else if (event.type === 'device') {
        upsertDevice(event.device);
      } else if (event.type === 'device_removed') {
        dropDevice(event.id);
      }
    };
    const next = new EmsRealtime(token, {
      onEvent,
      onState: setRealtime,
      onRefused: () => void endSession('Your EMS session ended. Sign in again.'),
    });
    channel.current = next;
    next.start();
    void refreshRef.current();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        next.wake();
      }
    });
    return () => {
      subscription.remove();
      next.stop();
      if (channel.current === next) {
        channel.current = null;
      }
    };
  }, [status, token, upsertDevice, dropDevice, endSession]);

  const signIn = useCallback(async (email: string, password: string) => begin(await api.signIn(email, password)), [begin]);

  const createAccount = useCallback(
    async (name: string, email: string, password: string) => begin(await api.createAccount(name, email, password)),
    [begin],
  );

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    await endSession(null);
  }, [endSession]);

  const value = useMemo<EmsContextValue>(
    () => ({
      status,
      user,
      configured: api.isEmsConfigured(),
      signIn,
      createAccount,
      signOut,
      sessionNotice,
      devices,
      devicesLoaded,
      devicesError,
      realtime,
      refreshDevices,
      upsertDevice,
      dropDevice,
    }),
    [
      status,
      user,
      signIn,
      createAccount,
      signOut,
      sessionNotice,
      devices,
      devicesLoaded,
      devicesError,
      realtime,
      refreshDevices,
      upsertDevice,
      dropDevice,
    ],
  );

  return <EmsContext.Provider value={value}>{children}</EmsContext.Provider>;
}
