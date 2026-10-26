import { createContext, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import * as api from '../services/ems/emsApi';
import { EmsRealtime } from '../services/ems/realtime';
import { sessionStore } from '../services/ems/sessionStore';
import { sortDevices } from '../services/home/capabilities';
import * as homeApi from '../services/home/homeApi';
import type { EmsEvent, EmsUser, RealtimeState } from '../types/ems.types';
import type { Device, Home, Room } from '../types/home.types';

/**
 * The EMS session and the resident's home: their unit, its hub, rooms and
 * live device list, shared by every screen that shows devices.
 *
 * Everything comes from the backend and is kept current by the realtime
 * channel, so a switch flipped from another phone or on the device itself
 * shows up without polling. When the channel is down the home is re-read on
 * reconnect and on returning to the foreground.
 */

export type EmsAuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** Why there is no home to show: not in a unit yet, still being set up, or the backend failed. */
export interface HomeProblem {
  code: string;
  message: string;
}

interface EmsContextValue {
  status: EmsAuthStatus;
  user: EmsUser | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Set when the backend ended the session (expired or revoked). */
  sessionNotice: string | null;

  home: Home | null;
  homeProblem: HomeProblem | null;
  rooms: Room[];
  devices: Device[];
  /** False until the first read after signing in has answered. */
  devicesLoaded: boolean;
  realtime: RealtimeState;
  refreshHome: () => Promise<void>;
  /** Puts a device the API returned (or an optimistic copy) into the list. */
  upsertDevice: (device: Device) => void;
  /** Bumped when the resident's linked accounts change, so screens showing them re-read. */
  accountsVersion: number;
}

export const EmsContext = createContext<EmsContextValue | undefined>(undefined);

function problemOf(error: unknown): HomeProblem {
  if (!(error instanceof api.EmsError)) {
    return { code: 'internal', message: 'Something went wrong talking to the EMS backend.' };
  }
  // A backend from before the smart-home service answers its routes with a bare "Not found."
  if (error.code === 'not_found') {
    return { code: 'unsupported', message: 'The smart home service is not available on this EMS server yet.' };
  }
  return { code: error.code, message: error.message };
}

export function EmsProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<EmsAuthStatus>('loading');
  const [user, setUser] = useState<EmsUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [homeProblem, setHomeProblem] = useState<HomeProblem | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [realtime, setRealtime] = useState<RealtimeState>('offline');
  const [accountsVersion, setAccountsVersion] = useState(0);
  const channel = useRef<EmsRealtime | null>(null);

  const endSession = useCallback(async (notice: string | null) => {
    channel.current?.stop();
    channel.current = null;
    api.setSessionToken(null);
    await sessionStore.clear();
    setToken(null);
    setUser(null);
    setHome(null);
    setHomeProblem(null);
    setRooms([]);
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

  const upsertDevice = useCallback((device: Device) => {
    setDevices((current) => sortDevices([...current.filter((entry) => entry.id !== device.id), device]));
  }, []);

  const dropDevice = useCallback((id: string) => {
    setDevices((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const refreshHome = useCallback(async () => {
    try {
      const next = await homeApi.getHome();
      setHome(next);
      setRooms(next.rooms);
      if (next.hub.status === 'provisioning') {
        setDevices([]);
        setHomeProblem({ code: 'provisioning', message: 'Your smart home is still being set up. Check back in a few minutes.' });
      } else {
        setDevices(sortDevices(await homeApi.listDevices()));
        setHomeProblem(null);
      }
      if (!user) {
        api.getMe().then((me) => setUser(me.user), () => undefined);
      }
    } catch (error) {
      const problem = problemOf(error);
      setHomeProblem(problem);
      if (problem.code === 'no_home') {
        setHome(null);
        setRooms([]);
        setDevices([]);
      }
    } finally {
      setDevicesLoaded(true);
    }
  }, [user]);

  const refreshRef = useRef(refreshHome);
  useEffect(() => {
    refreshRef.current = refreshHome;
  }, [refreshHome]);

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
      } else if (event.type === 'accounts') {
        setAccountsVersion((version) => version + 1);
      } else if (event.type === 'rooms') {
        setRooms(event.rooms);
      } else if (event.type === 'hub_status') {
        setHome((current) => (current ? { ...current, hub: { ...current.hub, status: event.status } } : current));
        if (event.status === 'online') {
          void refreshRef.current();
        }
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
      home,
      homeProblem,
      rooms,
      devices,
      devicesLoaded,
      realtime,
      refreshHome,
      upsertDevice,
      accountsVersion,
    }),
    [
      status,
      user,
      signIn,
      createAccount,
      signOut,
      sessionNotice,
      home,
      homeProblem,
      rooms,
      devices,
      devicesLoaded,
      realtime,
      refreshHome,
      upsertDevice,
      accountsVersion,
    ],
  );

  return <EmsContext.Provider value={value}>{children}</EmsContext.Provider>;
}
